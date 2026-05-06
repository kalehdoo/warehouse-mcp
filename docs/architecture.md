# Architecture

> *Last verified against v0.3.0. If you're reading this against a much newer release, spot-check `src/tools/registerAll.js` to confirm the dispatcher still matches the per-request flow below.*

This document explains **what happens inside warehouse-mcp when an MCP client makes a request** — what files execute, in what order, and how the safety layers compose. It's the orientation read for operators debugging production, security reviewers auditing the codebase, and contributors adding new functionality.

For related concerns:
- **Why the safety layers exist** — see [threat-model.md](threat-model.md)
- **What to do when a step fails** — see [troubleshooting.md](troubleshooting.md)
- **How to add a new warehouse adapter** — see [../CONTRIBUTING.md](../CONTRIBUTING.md)

---

## Bootstrap (happens once, at server startup)

`src/index.js` runs `main()` in order:

1. **`maybeInitTracing()`** — `src/observability/otel.js` — no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set
2. **`loadConfig()`** — `src/util/config.js` — zod-validates every env var, returns a structured config object
3. **`new EnvConfigProvider(config)`** — wraps the config behind an abstraction so the SaaS variant can swap it later without touching call sites
4. **`new JsonlAuditSink({...})`** — `src/audit/jsonlSink.js` — opens the audit-log writer
5. **`new TokenBucketRateLimiter(rpm)`** — `src/security/rateLimit.js` — per-principal token bucket
6. **`buildGuardrailPipeline()`** — `src/guardrails/index.js` — reads `GUARDRAIL_*` env knobs, registers the configured guardrails (e.g. `outputPiiMask` if `GUARDRAIL_PII_MASK=on`)
7. **`startHttpTransport({...})` or `startStdioTransport({...})`** — binds the chosen transport with all four "deps" injected: `provider`, `audit`, `rateLimiter`, `guardrails`

After step 7 the server is sitting on `MCP_SERVER_PORT` (default 3001), ready. Every request gets the same four deps injected automatically — no per-request setup.

---

## Per-request flow

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
│  │     → src/security/policy.js (does "reader" allow "query"?)   │
│  │                                                                │
│  ├─ 2. rateLimiter.charge(ctx.principal)                          │
│  │     → src/security/rateLimit.js (token-bucket check)          │
│  │                                                                │
│  ├─ 3. guardrails.runPre(ctx, "query", args)   ← pre-guardrails  │
│  │     → src/guardrails/pipeline.js                               │
│  │     • for each pre-guardrail: evaluate(...)                    │
│  │     • short-circuits if any returns deny / approve_required    │
│  │     • currently no pre-guardrails enabled in v0.3              │
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
3. Add it to the role allowlist in `src/security/policy.js` (decide: which of the four tiers can invoke it?).
4. Write tests under `test/tools/` using `setupDemo()` from `test/tools/helpers.js`.

The dispatcher applies all the existing safety rails automatically — role check, rate limit, guardrails, audit. You don't write any of that yourself.

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

```
src/transport/http.js          ← HTTP request lands here (or stdio.js for stdio)
src/auth/bearer.js             ← Authentication
src/auth/context.js            ← Context object
src/server.js                  ← Per-session McpServer
src/tools/registerAll.js       ← The dispatcher (heart of the flow)
src/security/policy.js         ← Role-based authz
src/security/rateLimit.js      ← Token bucket
src/guardrails/pipeline.js     ← Pre/post pipeline runner
src/guardrails/index.js        ← Pipeline assembly from env knobs
src/tools/<name>.js            ← The actual tool (one per tool)
src/adapters/index.js          ← Adapter factory + per-tenant pool
src/adapters/<name>.js         ← The actual warehouse adapter
src/security/sqlValidator.js   ← Read-only SQL enforcement
src/util/resultCap.js          ← Hard row × column cap
src/guardrails/post/*.js       ← Post-guardrails (e.g. outputPiiMask)
src/audit/jsonlSink.js         ← Final audit record
```

If you've read this far and the flow makes sense, you understand warehouse-mcp's spine. Every other file in the codebase is either implementation of one of these steps, configuration of them, or test scaffolding around them.
