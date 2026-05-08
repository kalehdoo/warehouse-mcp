# Architecture

> *Last verified against v0.4.2. If you're reading this against a much newer release, spot-check `src/index.js` (boot order), `src/server.js` (per-session assembly), and `src/tools/registerAll.js` (dispatcher) to confirm the flow below still matches.*

This document explains **what happens inside warehouse-mcp when an MCP client makes a request** — what files execute, in what order, and how the safety layers compose. It's the orientation read for operators debugging production, security reviewers auditing the codebase, and contributors adding new functionality.

There are now two request flows:
- **Tool calls** (`tools/call`) — the safety-layered dispatcher path. The bulk of this doc.
- **Resource reads** (`resources/read`) — added in v0.4.0 to expose the semantic-metadata layer. Lighter path; documented in [Resources path](#resources-path-the-second-request-flow) below.

For related concerns:
- **Why the safety layers exist** — see [threat-model.md](threat-model.md)
- **What to do when a step fails** — see [troubleshooting.md](troubleshooting.md)
- **How to add a new warehouse adapter** — see [../CONTRIBUTING.md](../CONTRIBUTING.md)
- **The semantic-metadata layer in detail** — see [semantic-metadata.md](semantic-metadata.md)

---

## Bootstrap (happens once, at server startup)

`src/index.js` runs `main()` in order:

1. **`maybeInitTracing()`** — `src/observability/otel.js` — no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set
2. **`loadConfig()`** — `src/util/config.js` — zod-validates every env var, returns a structured config object
3. **`new EnvConfigProvider(config)`** — wraps the config behind an abstraction so the SaaS variant can swap it later without touching call sites
4. **`new JsonlAuditSink({...})`** — `src/audit/jsonlSink.js` — opens the audit-log writer
5. **`new TokenBucketRateLimiter(rpm)`** — `src/security/rateLimit.js` — per-principal token bucket
6. **`buildGuardrailPipeline()`** — `src/guardrails/index.js` — reads `GUARDRAIL_*` env knobs, registers the configured guardrails (e.g. `outputPiiMask` if `GUARDRAIL_PII_MASK=on`)
7. **`loadSemantic({dir: config.semantic.dir})`** — `src/semantic/loader.js` — added in v0.4.0. If `SEMANTIC_DIR` is set, walks that directory, parses + validates every `glossary.yml` / `schemas.yml` / `<schema>.yml` file, and builds an in-memory index. If not set or the directory is missing, the layer is silently disabled and no resources are registered. Schema errors and duplicate-key collisions fail boot with a clear message.
8. **`startHttpTransport({...})` or `startStdioTransport({...})`** — binds the chosen transport with all five "deps" injected: `provider`, `audit`, `rateLimiter`, `guardrails`, `semantic`

After step 8 the server is sitting on `MCP_SERVER_PORT` (default 3001), ready. Every request gets the same five deps injected automatically — no per-request setup. The semantic index is loaded once and served from memory, so resource reads never touch the filesystem after boot.

---

## Per-request flow (tool calls)

Concrete example: **Claude Desktop calls `tools/call` for `query` with `SELECT 42`.**

```
┌──────────────────────────────────────────────────────────────────┐
│ Claude Desktop                                                    │
│   POST /mcp  Authorization: Bearer abc123  body=tools/call query  │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/transport/http.js                                             │
│ • applyCors()                                                     │
│ • authenticate(req, provider)  →  src/auth/bearer.js              │
│   • extractBearer() → "abc123"                                    │
│   • lookup in apiKeys map → {role:"reader", warehouseRole:"alice"}│
│   • makeContext(...) → ctx  (src/auth/context.js)                 │
│ • new session? buildServer(ctx, deps) (src/server.js)             │
│   • registerAllTools(server, ctx, deps)                           │
│     → ⚠ ROLE-FILTERED REGISTRATION (v0.4.2):                      │
│       only tools where isToolAllowed(ctx.role, name) are          │
│       registered. tools/list naturally returns the role's catalog,│
│       not the full set. Disallowed tools never appear to the AI.  │
│   • if deps.semantic has data: registerSemanticResources(...)     │
│ • transport.handleRequest(req, res)                               │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ MCP SDK                                                           │
│ • parses JSON-RPC                                                 │
│ • validates args against tool's Zod inputSchema                   │
│ • invokes the closure registered by registerTool(...)             │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/tools/registerAll.js  — the tool dispatcher                   │
│                                                                   │
│  withSpan("tool.query", async () => {                             │
│                                                                   │
│  ┌─ 1. assertToolAllowed(ctx, "query")                           │
│  │     → src/security/policy.js                                   │
│  │     defense-in-depth: registration already filtered, but if    │
│  │     a future code path bypasses the filter this still denies.  │
│  │                                                                │
│  ├─ 2. rateLimiter.charge(ctx.principal)                          │
│  │     → src/security/rateLimit.js (token-bucket check)          │
│  │                                                                │
│  ├─ 3. guardrails.runPre(ctx, "query", args)   ← pre-guardrails  │
│  │     → src/guardrails/pipeline.js                               │
│  │     • for each pre-guardrail: evaluate(...)                    │
│  │     • short-circuits if any returns deny / approve_required    │
│  │     • no built-in pre-guardrails ship today; the slot exists   │
│  │       so deployments can plug in their own (sensitive-table    │
│  │       deny, large-result approval, etc.)                       │
│  │                                                                │
│  ├─ 4. await def.handler(args, ctx, deps)   ← the tool itself    │
│  │     → src/tools/query.js                                       │
│  │     • adapter = getAdapter(ctx, provider)                      │
│  │       → src/adapters/index.js (lazy-loads postgres.js)         │
│  │     • normalizeReadOnlySql(sql, {dialect, ...})                │
│  │       → src/security/sqlValidator.js                           │
│  │     • adapter.query(safeSql, {warehouseRole:"alice"})          │
│  │       → src/adapters/postgres.js                               │
│  │       • pool.connect()                                         │
│  │       • SET ROLE "alice"                                       │
│  │       • client.query(safeSql)                                  │
│  │       • RESET ROLE                                             │
│  │       • client.release()                                       │
│  │                                                                │
│  ├─ 5. result = applyResultCap(result, maxCells)                  │
│  │     → src/util/resultCap.js (truncate if > 100k cells)         │
│  │                                                                │
│  ├─ 6. guardrails.runPost(ctx, "query", args, result)            │
│  │     → src/guardrails/pipeline.js                               │
│  │     • for each post-guardrail: evaluate(...)                   │
│  │     • outputPiiMask transforms emails/SSNs/etc per ctx.role    │
│  │       → src/guardrails/post/outputPiiMask.js                   │
│  │                                                                │
│  ├─ 7. audit.write({ ctx, tool, rowCount, durationMs, ... })     │
│  │     → src/audit/jsonlSink.js (appendFileSync to JSONL)        │
│  │                                                                │
│  └─ 8. return { content: [{type:"text", text: JSON.stringify(result)}] }│
│                                                                   │
│  })  ← end withSpan                                               │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
              MCP SDK serializes as SSE event
                          ▼
              HTTP response → Claude Desktop
```

The dispatcher in `src/tools/registerAll.js` is the load-bearing piece. **Every tool call goes through this exact sequence, no exceptions.** When you add a safety layer, you add it as a guardrail and the pipeline picks it up automatically — no per-handler bookkeeping.

### What v0.4.2 changed about role enforcement

Before v0.4.2, every session advertised the full 13-tool catalog regardless of role. The agent would try a disallowed tool, the dispatcher would deny it at step 1, and we'd waste a round-trip plus produce noisy denial entries in the audit log.

In v0.4.2, `registerAllTools` skips registration entirely for tools the role can't invoke. The MCP SDK's `tools/list` is derived from registered tools, so each role sees a different catalog:

| Role | Tools advertised |
|---|---|
| `admin`, `reader` | All 13 |
| `reader_restricted` | 11 (drops `query`, `search_value`) |
| `metadata_only` | 6 (catalog discovery only) |

The `assertToolAllowed` call at step 1 of the dispatcher is now redundant on the happy path — but it stays as defense-in-depth in case a future refactor introduces a code path that bypasses registration.

---

## Resources path (the second request flow)

Added in v0.4.0 to expose semantic metadata (business glossary, schema docs, table docs) without overloading the tools system. Resources are the third MCP primitive — alongside tools and prompts — and the discovery model is *"the agent reads what it wants when it wants it,"* not *"the server pushes what it wants the agent to know."*

The flow is much simpler than the tool flow because **resources are read-only, in-memory, and do not touch the warehouse**.

```
┌──────────────────────────────────────────────────────────────────┐
│ Claude Desktop                                                    │
│   POST /mcp  body=resources/list  (or resources/read)             │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/transport/http.js                                             │
│ • applyCors() + authenticate(...)  (same as tool flow)            │
│ • new session? buildServer(ctx, deps)                             │
│   • registerSemanticResources(server, deps.semantic)              │
│     → src/semantic/resources.js                                   │
│     registers (only when semantic dir loaded with content):       │
│       warehouse://semantic/glossary                               │
│       warehouse://semantic/glossary/{term}                        │
│       warehouse://semantic/schemas/list                           │
│       warehouse://semantic/schemas/{schema}     (v0.4.1)          │
│       warehouse://semantic/tables/{schema}/{table}                │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ MCP SDK                                                           │
│ • for resources/list: returns the registered URI templates        │
│ • for resources/read: invokes the closure registered for that URI │
│   • closure looks up the term/schema/table in the in-memory       │
│     index (deps.semantic) and returns the JSON                    │
└─────────────────────────┬────────────────────────────────────────┘
                          ▼
              MCP SDK serializes as SSE event
                          ▼
              HTTP response → Claude Desktop
```

### What's deliberately NOT on this path

- **No SQL.** Resources never run a query; they serve documentation. The warehouse adapter is not involved.
- **No guardrails.** The pipeline is for tool calls. Resources don't see arguments and don't return rows; PII masking is irrelevant. Role checks are also intentionally absent — semantic metadata is treated as catalog-level documentation that any authenticated principal can read. If a deployment needs role-restricted resources, that's a future change to `registerSemanticResources`.
- **No audit log entry.** Resources are typically polled at session start by the AI client; logging each one would drown the meaningful tool-call records. If you need visibility into resource reads today, the cheapest hook point is wrapping the closures registered in `src/semantic/resources.js` — there's no built-in OTel span on this path yet.
- **No caching layer.** The semantic index is already in memory — caching would just shadow the source of truth.

The semantic layer is intentionally additive: customers who don't set `SEMANTIC_DIR` see no change in behavior. See [semantic-metadata.md](semantic-metadata.md) for the file format and how the index is built.

---

## Pre vs post guardrails

Both are managed by `src/guardrails/pipeline.js` but have different semantics — the difference is intentional.

| Property | `runPre` | `runPost` |
|---|---|---|
| **When** | Before tool handler | After tool handler |
| **Receives** | `(ctx, toolName, args)` | `(ctx, toolName, args, result)` |
| **Returns** | `{action: allow / deny / approve_required}` | `{result: transformed}` |
| **Short-circuit** | First `deny` stops the chain — tool never runs | Always runs every guardrail (each transforms the previous output) |
| **Bug behavior** | **Fail closed** — buggy guardrail = deny the call | **Fail open** — buggy guardrail = log + skip, response still goes back |

### Why different bug behavior

**Skipping a deny is unsafe** — a security check missed can leak data. **Skipping a transform is degraded UX** — PII slipped through unmasked once is bad but not catastrophic. The asymmetry is hardcoded in `src/guardrails/pipeline.js` and protects you from your own future bugs.

---

## Concrete audit example

For the `SELECT 42` request above, the audit record at the end looks like:

```json
{
  "ts": "2026-05-05T19:42:11.873Z",
  "tenant_id": "default",
  "principal": "key_abc123",
  "role": "reader",
  "warehouse_role": "alice",
  "request_id": "req_mosj2y_xyz",
  "tool": "query",
  "sql": null,
  "row_count": 1,
  "duration_ms": 42,
  "guardrail_events": [
    { "guardrail": "output_pii_mask", "action": "transform", "reason": "masked 0 fields at level=partial" }
  ]
}
```

Every field on that record corresponds to a step in the flow above. The audit log is the operator's primary observability surface — tail it during a session to watch the system work in real time:

```bash
tail -f /app/audit/audit-$(date -u +%F).jsonl | jq
```

---

## Extending the system

### Adding a new pre-guardrail

Goal: deny calls that would scan a sensitive table, or require human approval for big result sets.

1. Create `src/guardrails/pre/<name>.js`:
   ```js
   export const yourGuardrail = {
     name: "your_guardrail_name",
     kind: "pre",
     async evaluate(ctx, toolName, args) {
       // Inspect ctx, toolName, args. Return one of:
       return { action: "allow" };
       // or
       return {
         action: "deny",
         reason: "human-readable reason",
         event: { guardrail: "your_guardrail_name", action: "deny", reason: "..." },
       };
     },
   };
   ```
2. Register it in `src/guardrails/index.js`:
   ```js
   if (isOn(env.GUARDRAIL_YOUR_NAME)) pre.push(yourGuardrail);
   ```
3. Document the env knob in `.env.example`.
4. Add tests under `test/guardrails/`.

The pipeline picks it up automatically. No tool handler changes needed.

### Adding a new post-guardrail

Identical pattern with `kind: "post"` and an `evaluate` that takes one extra `result` argument and returns `{result: transformed}`. See `src/guardrails/post/outputPiiMask.js` as the canonical example.

### Adding a new tool

1. Create `src/tools/<name>.js`:
   ```js
   import { z } from "zod";
   import { getAdapter } from "../adapters/index.js";

   export const yourTool = {
     name: "your_tool",
     description: "What it does, in one sentence.",
     inputSchema: {
       schema: z.string().min(1),
       // ...other params
     },
     async handler(args, ctx, deps) {
       const adapter = await getAdapter(ctx, deps.provider);
       // ...do work, return a result object
     },
   };
   ```
2. Register it in `src/tools/index.js` by adding to the `TOOL_DEFINITIONS` array.
3. **Decide which roles can invoke it** and add it to `src/security/policy.js`. Since v0.4.2 this matters at registration time, not just call time — roles that don't allow the new tool won't see it in their `tools/list` at all. Pick a tier (`metadata_only` / `reader_restricted` / `reader` / `admin`) intentionally; the default of "registered for everyone" is what you get if you forget to update the policy.
4. Write tests under `test/tools/` using `setupDemo()` from `test/tools/helpers.js`. Add a registration test in `test/tools/registerAll.test.js` confirming the tool only appears for the tiers you intended.

The dispatcher applies all the existing safety rails automatically — role check, rate limit, guardrails, audit. You don't write any of that yourself.

### Adding a new semantic-resource type

If you want to expose a new kind of catalog documentation (e.g. lineage, ownership, KPI definitions) as an MCP resource:

1. Extend the YAML schema in `src/semantic/schema.js` with a zod definition for the new file kind.
2. Teach `src/semantic/loader.js` to detect and parse it (the `classify(filePath)` function returns the file's kind; add a new branch).
3. Register the resource URI in `src/semantic/resources.js` using `server.registerResource()` with a `ResourceTemplate` for parameterized URIs.
4. Add a sample to `docs/semantic-templates/` and document the format in `docs/semantic-metadata.md`.
5. Write a loader test under `test/semantic/`.

The boot loader will pick up the new file shape as long as it lives under `SEMANTIC_DIR`. No changes to `src/index.js` or `src/server.js` are needed.

### Adding a new warehouse adapter

See [../CONTRIBUTING.md](../CONTRIBUTING.md) — the "Adding a new warehouse adapter" section walks through the 5-step recipe with a reference implementation to copy.

---

## What's deliberately not in the flow

Three things you might expect that aren't here, on purpose:

- **Pre-LLM prompt processing.** warehouse-mcp doesn't see the prompt — only the tool call the LLM produced. Prompt-injection detection and input PII redaction belong in the AI client (Claude Desktop, Cursor, custom agent), not in this codebase. See [threat-model.md](threat-model.md) for the full reasoning.
- **Model invocation.** This is a tool server, not an agent. Claude is the agent; warehouse-mcp just responds to its tool calls.
- **SQL generation.** When `query` is called, the SQL is already in the args (Claude composed it). Our job is to validate and execute it safely, not generate it.

---

## File reference card (everything in execution order)

**Boot:**
```
src/index.js                   ← main(): wires deps and starts the transport
src/util/config.js             ← zod-validated env loader
src/audit/jsonlSink.js         ← Audit writer (opened once at boot)
src/security/rateLimit.js      ← Token bucket factory
src/guardrails/index.js        ← Pipeline assembly from GUARDRAIL_* env
src/semantic/loader.js         ← v0.4.0+ — walks SEMANTIC_DIR, builds index
src/semantic/schema.js         ← zod schemas for glossary / schemas / models YAML
```

**Tool flow:**
```
src/transport/http.js          ← HTTP request lands here (or stdio.js for stdio)
src/auth/bearer.js             ← Authentication
src/auth/context.js            ← Context object
src/server.js                  ← Per-session McpServer + resource registration
src/tools/registerAll.js       ← Dispatcher + role-filtered registration (v0.4.2)
src/security/policy.js         ← Role-based authz (isToolAllowed, listToolsForRole)
src/guardrails/pipeline.js     ← Pre/post pipeline runner
src/tools/<name>.js            ← The actual tool (one per tool)
src/adapters/index.js          ← Adapter factory + per-tenant pool
src/adapters/<name>.js         ← The actual warehouse adapter
src/security/sqlValidator.js   ← Read-only SQL enforcement
src/util/resultCap.js          ← Hard row × column cap
src/guardrails/post/*.js       ← Post-guardrails (e.g. outputPiiMask)
src/audit/jsonlSink.js         ← Final audit record
```

**Resource flow (v0.4.0+):**
```
src/transport/http.js          ← (same entry point)
src/auth/bearer.js             ← (same auth)
src/server.js                  ← buildServer also calls registerSemanticResources
src/semantic/resources.js      ← Registers warehouse://semantic/* URIs
                                 against the in-memory index built at boot
```

If you've read this far and the flow makes sense, you understand warehouse-mcp's spine. Every other file in the codebase is either implementation of one of these steps, configuration of them, or test scaffolding around them.
