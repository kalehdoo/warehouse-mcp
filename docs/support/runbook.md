# warehouse-mcp — Engineering Runbook

> A standalone onboarding + reference document for developers who will **rewrite this project from scratch**.
> It explains what the system is, how a request flows end to end, which files matter, and the order to build them in.
>
> Companion deep-dives live in [`modules/`](./modules/) — each one references a section here and expands on it.
> See also the existing repo docs: [`docs/architecture.md`](../architecture.md) and [`docs/onboarding.md`](../onboarding.md).

---

## 1. What this project is (30-second version)

`warehouse-mcp` is an **MCP (Model Context Protocol) server** that lets an AI agent (Claude Desktop, Cursor, a custom MCP client) safely query a data warehouse — Postgres, Oracle, Snowflake, BigQuery, Redshift, or DuckDB/MotherDuck.

The entire product is one promise:

> An LLM can **explore and read** your warehouse, but it can **never write** to it, can **never escape its role's permissions**, and **every action is logged**.

Almost all the code exists to enforce that promise. If you remember nothing else, remember that the safety boundary is the product.

It decomposes into three layers:

| Layer | Responsibility | Key files |
|---|---|---|
| **Transport** | How a client connects | [`src/transport/stdio.js`](../../src/transport/stdio.js), [`src/transport/http.js`](../../src/transport/http.js) |
| **Tool** | The "verbs" the agent can call, wrapped in a security/audit pipeline | [`src/tools/`](../../src/tools/) |
| **Adapter** | Per-warehouse drivers that translate a generic request into vendor SQL | [`src/adapters/`](../../src/adapters/) |

---

## 2. The boot sequence — what runs first and how it traverses

### 2.1 Entry point — [`bin/warehouse-mcp.js`](../../bin/warehouse-mcp.js)

This is the **first file the system runs** (declared as the `bin` in [`package.json`](../../package.json#L9-L11)). It does almost nothing — it forwards CLI args to the router:

```js
runCli(process.argv.slice(2)).catch(/* print error, exit 1 */);
```

### 2.2 Command router — [`src/cli/router.js`](../../src/cli/router.js)

A tiny `switch` mapping a subcommand to a lazily-imported handler:

- `init`   → [`src/cli/init.js`](../../src/cli/init.js) — interactive setup, writes `.env`.
- `start`  → [`src/cli/start.js`](../../src/cli/start.js) — boots the server (the main path).
- `doctor` → [`src/cli/doctor.js`](../../src/cli/doctor.js) — validates config without booting.

> `npm start` runs `node src/index.js` directly ([`package.json`](../../package.json#L18)), the same boot logic the `start` command reaches.

### 2.3 Composition root — [`src/index.js`](../../src/index.js)

**The single most important file for understanding the architecture.** Its `main()` builds every long-lived dependency exactly once, then picks a transport. In order:

| Step | Builds | File |
|---|---|---|
| `maybeInitTracing()` | OpenTelemetry tracing (optional) | [`src/observability/otel.js`](../../src/observability/otel.js) |
| `loadConfig()` | Parses env vars → typed config object | [`src/util/config.js`](../../src/util/config.js) |
| `new EnvConfigProvider()` | Abstraction over config (SaaS can swap it) | [`src/util/config.js`](../../src/util/config.js#L192) |
| `new JsonlAuditSink()` | Append-only audit log writer | [`src/audit/jsonlSink.js`](../../src/audit/jsonlSink.js) |
| `new TokenBucketRateLimiter()` | Per-principal rate limiting | [`src/security/rateLimit.js`](../../src/security/rateLimit.js) |
| `buildGuardrailPipeline()` | Pre/post request guardrails | [`src/guardrails/index.js`](../../src/guardrails/index.js) |
| `loadSemantic()` | Loads optional YAML business glossary | [`src/semantic/index.js`](../../src/semantic/index.js) |

It registers `SIGINT`/`SIGTERM` shutdown handlers (close audit, close adapters), then branches:

```js
if (config.transport === "stdio") await startStdioTransport({ ...deps });
else                              startHttpTransport({ ...deps });
```

**Key idea:** all dependencies (`provider`, `audit`, `rateLimiter`, `guardrails`, `semantic`) are bundled into a `deps` object and **threaded down** through the transports into every tool call. There are **no global singletons** for these — this is *dependency injection by hand*, the pattern the whole codebase follows. (The one exception is the adapter connection pool; see §6.)

➡ Deep dive: [`modules/01-entry-and-bootstrap.md`](./modules/01-entry-and-bootstrap.md)

---

## 3. The two transports — where a request enters

### 3.1 stdio — [`src/transport/stdio.js`](../../src/transport/stdio.js)

For desktop clients. The OS process boundary **is** the trust boundary, so there is no authentication — it synthesizes a single `admin` `Context` and connects one MCP server.

### 3.2 HTTP — [`src/transport/http.js`](../../src/transport/http.js)

For remote / multi-user deployments. Richer:

- Handles CORS, a `/health` endpoint, routes `/mcp`.
- **Authenticates every request** via [`src/auth/bearer.js`](../../src/auth/bearer.js) before anything else.
- Maintains a `Map` of **sessions** keyed by the `mcp-session-id` header. Each session gets **its own `McpServer` instance bound to its own auth `Context`**.

➡ Deep dive: [`modules/04-transports.md`](./modules/04-transports.md)

---

## 4. The central architectural idea: per-session server bound to a Context

### 4.1 The `Context` — [`src/auth/context.js`](../../src/auth/context.js)

Every request carries a `Context` (built by `makeContext`): `tenantId`, `role`, `principal`, optional `warehouseRole`, `includeSemantic`, `requestId`. **This object is the spine of the system** — it is threaded through tools, adapters, audit, guardrails, and policy checks.

### 4.2 `buildServer(ctx, deps)` — [`src/server.js`](../../src/server.js)

Instead of one shared server, **each session builds its own `McpServer`** and the `ctx` is captured by closure inside every tool handler. This is why role/tenant/principal flow into every tool call without being passed as explicit arguments everywhere. It also conditionally registers the semantic resources behind three gates (session opted in, index has content, dep was wired through).

➡ Deep dives: [`modules/03-context-and-auth.md`](./modules/03-context-and-auth.md), [`modules/05-server-and-registration.md`](./modules/05-server-and-registration.md)

---

## 5. The tool layer — the agent's capabilities

### 5.1 The catalog — [`src/tools/index.js`](../../src/tools/index.js)

`TOOL_DEFINITIONS` is a flat, **order-significant** list of every tool, grouped by intent:

- **Semantic lookups** (in-memory, no DB I/O): `glossary_lookup`, `schema_lookup`, `table_lookup` — [`src/tools/semantic.js`](../../src/tools/semantic.js)
- **Free-form**: `query` — [`src/tools/query.js`](../../src/tools/query.js)
- **Catalog discovery**: `list_schemas`, `list_tables`, `describe_table`, `find_columns`, `get_foreign_keys`, `get_view_definition` — [`src/tools/catalog.js`](../../src/tools/catalog.js)
- **Single-table profiling**: `sample_table`, `count_rows`, `column_stats`, `top_values`, `time_series` — [`src/tools/profile.js`](../../src/tools/profile.js)
- **Search**: `search_value` — [`src/tools/search.js`](../../src/tools/search.js)

Each tool is a plain object: `{ name, description, inputSchema (zod), handler }`.

### 5.2 The request pipeline — [`src/tools/registerAll.js`](../../src/tools/registerAll.js)

**The most important file for the security model.** For each tool it first checks `isToolAllowed(role, name)` and **skips registration entirely** if the role can't use it (so a `metadata_only` agent never even *sees* `query`). Then it wraps the handler with this exact order of operations:

```
1. assertToolAllowed(ctx, name)     ← role gate (defense in depth)
2. rateLimiter.charge(principal)    ← rate limit
3. guardrails.runPre(...)           ← may deny / require approval (short-circuit)
4. def.handler(args, ctx, deps)     ← the actual work
5. applyResultCap(result)           ← truncate oversized results
6. guardrails.runPost(...)          ← PII mask, redact
7. audit.write({...})               ← ALWAYS, success or failure
```

Everything is wrapped in `withSpan` (tracing) and a `try/catch` that audits errors too.

➡ Deep dives: [`modules/05-server-and-registration.md`](./modules/05-server-and-registration.md), [`modules/06-tools.md`](./modules/06-tools.md)

---

## 6. The adapter layer — multi-warehouse support

### 6.1 Lazy adapter pool — [`src/adapters/index.js`](../../src/adapters/index.js)

`getAdapter(ctx, provider)` returns (or lazily creates) the adapter for a tenant. Drivers are **dynamically `import()`-ed only when their warehouse type is selected** — a Postgres deployment never loads the heavy Snowflake/AWS SDK. This `_pool` `Map` is the one piece of process-global mutable state.

### 6.2 The adapter contract — [`src/adapters/types.js`](../../src/adapters/types.js)

Every adapter implements the same interface: `query`, `listSchemas`, `listTables`, `describeTable`, `sample`, `findColumns`, `getForeignKeys`, `getViewDefinition`, `close`. This keeps tools warehouse-agnostic.

Concrete adapters: [`postgres.js`](../../src/adapters/postgres.js) (the reference impl), [`redshift.js`](../../src/adapters/redshift.js) (reuses Postgres), [`oracle.js`](../../src/adapters/oracle.js), [`snowflake.js`](../../src/adapters/snowflake.js), [`bigquery.js`](../../src/adapters/bigquery.js), [`duckdb.js`](../../src/adapters/duckdb.js).

> Study Postgres first. Note its `warehouseRole` feature: `SET ROLE` / `RESET ROLE` pushes per-key security **down into the warehouse's own RLS/CLS/masking policies** instead of duplicating them in MCP.

➡ Deep dive: [`modules/08-adapters.md`](./modules/08-adapters.md)

---

## 7. The security boundary (the "never writes" promise)

### 7.1 Role-based access — [`src/security/policy.js`](../../src/security/policy.js)

Five tiers, each a **superset** of the previous:

```
semantic_only ⊂ metadata_only ⊂ reader_restricted ⊂ reader ⊂ admin
```

Each role maps to a `Set` of allowed tool names. Disallowed tools are never registered for that session.

### 7.2 Read-only SQL enforcement — [`src/security/sqlValidator.js`](../../src/security/sqlValidator.js)

`normalizeReadOnlySql` is the **load-bearing safety code**. Given raw SQL it: strips comments; rejects multiple statements; allows only `SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA`; rejects write keywords and recursive CTEs; caps `UNION` count; and **auto-applies a row LIMIT** (or Oracle `FETCH FIRST n ROWS ONLY`) when missing. *Any change here is load-bearing for the entire product.*

### 7.3 Authentication — [`src/auth/bearer.js`](../../src/auth/bearer.js) + [`src/auth/jwt.js`](../../src/auth/jwt.js)

Resolution order: no auth configured → anonymous admin (dev only); static API key match → role from `MCP_API_KEYS`; else JWT against OIDC issuer; else `401`.

➡ Deep dive: [`modules/07-security.md`](./modules/07-security.md)

---

## 8. Cross-cutting concerns

| Concern | Module | What it does |
|---|---|---|
| Audit | [`src/audit/jsonlSink.js`](../../src/audit/jsonlSink.js) | Append-only JSONL, one record per tool call, field-size clipped |
| Guardrails | [`src/guardrails/`](../../src/guardrails/) | Pre/post pipeline; fails **closed**; PII masking is the shipped post-guardrail |
| Rate limiting | [`src/security/rateLimit.js`](../../src/security/rateLimit.js) | Per-principal token bucket |
| Result cap | [`src/util/resultCap.js`](../../src/util/resultCap.js) | Caps result `cells = rows × cols` |
| Observability | [`src/observability/otel.js`](../../src/observability/otel.js) | Optional OpenTelemetry spans |
| Semantic | [`src/semantic/`](../../src/semantic/) | Optional YAML glossary exposed as MCP resources |

➡ Deep dives: [`modules/09-guardrails.md`](./modules/09-guardrails.md), [`modules/10-audit-and-observability.md`](./modules/10-audit-and-observability.md), [`modules/11-semantic.md`](./modules/11-semantic.md)

---

## 9. A complete request trace (tie it all together)

A `query` call from an HTTP client, end to end:

```
HTTP POST /mcp
  → http.js: applyCors → authenticate() [bearer.js] → produces ctx {role, tenant, principal}
  → find/create session → buildServer(ctx, deps) [server.js]
  → MCP SDK dispatches the "query" tool
  → registerAll.js wrapper:
       1. assertToolAllowed(ctx, "query")        [policy.js]      ← role gate
       2. rateLimiter.charge(ctx.principal)        [rateLimit.js]
       3. guardrails.runPre(...)                   [pipeline.js]   ← may deny
       4. queryTool.handler(args, ctx, deps):      [query.js]
            → getAdapter(ctx, provider)            [adapters/index.js]
            → normalizeReadOnlySql(sql, dialect)   [sqlValidator.js] ← read-only enforcement
            → adapter.query(safeSql)               [postgres.js]   ← real DB hit
       5. applyResultCap(result)                   [resultCap.js]
       6. guardrails.runPost(...) → PII mask       [outputPiiMask.js]
       7. audit.write({ctx, tool, rowCount, ...})  [jsonlSink.js]
  → JSON response back to the agent
```

---

## 10. Suggested build order for the rewrite

Mirror the dependency graph — build bottom-up so each layer can be tested before the next depends on it:

1. **[`src/util/config.js`](../../src/util/config.js)** — config + the `ConfigProvider` abstraction. Everything depends on it. → [module 02](./modules/02-config.md)
2. **[`src/auth/context.js`](../../src/auth/context.js)** — the `Context` shape everything threads. → [module 03](./modules/03-context-and-auth.md)
3. **[`src/security/policy.js`](../../src/security/policy.js)** + **[`sqlValidator.js`](../../src/security/sqlValidator.js)** — the safety core. Get this right first. → [module 07](./modules/07-security.md)
4. **[`src/adapters/types.js`](../../src/adapters/types.js)** + **[`postgres.js`](../../src/adapters/postgres.js)** + **[`index.js`](../../src/adapters/index.js)** — one adapter + the pool. → [module 08](./modules/08-adapters.md)
5. **[`src/tools/*`](../../src/tools/)** — tool definitions + the **registerAll.js** pipeline. → [modules 05 & 06](./modules/06-tools.md)
6. **[`src/server.js`](../../src/server.js)** — `buildServer` wiring tools to a Context. → [module 05](./modules/05-server-and-registration.md)
7. **[`stdio.js`](../../src/transport/stdio.js)** then **[`http.js`](../../src/transport/http.js)** + **[`bearer.js`](../../src/auth/bearer.js)**. → [modules 03 & 04](./modules/04-transports.md)
8. **[`src/index.js`](../../src/index.js)** + **[`bin/warehouse-mcp.js`](../../bin/warehouse-mcp.js)** — the composition root. → [module 01](./modules/01-entry-and-bootstrap.md)
9. Cross-cutting extras: audit, guardrails, rate limit, observability, semantic — each independent and pluggable. → [modules 09–11](./modules/09-guardrails.md)

---

## 11. Mental models to carry into the rewrite

- **The `Context` is the spine.** Auth produces it once per session; it flows everywhere; security decisions read from it.
- **`registerAll.js` is the choke point.** Every capability passes through the same 7-step gauntlet. Add cross-cutting behavior there, not in individual tools.
- **`sqlValidator.js` and `policy.js` are where the product's safety lives.** Treat changes there as high-stakes; they deserve the densest tests.
- **Adapters are swappable behind one interface.** Tools never know which warehouse they talk to; new dialects are added in `sqlDialect.js` + a new adapter, nowhere else.
- **Dependency injection by hand, no globals** (except the adapter pool). `deps` flows `index.js` → transport → `buildServer` → tools.
- **Fail closed.** Guardrail errors deny; audit failures never break a call; unknown roles get zero tools.

---

## 12. Module index

| # | Module | Covers |
|---|---|---|
| 01 | [Entry & bootstrap](./modules/01-entry-and-bootstrap.md) | `bin/`, `cli/`, `index.js` |
| 02 | [Configuration](./modules/02-config.md) | `util/config.js`, `ConfigProvider` |
| 03 | [Context & auth](./modules/03-context-and-auth.md) | `auth/context.js`, `bearer.js`, `jwt.js` |
| 04 | [Transports](./modules/04-transports.md) | `transport/stdio.js`, `transport/http.js` |
| 05 | [Server & tool registration](./modules/05-server-and-registration.md) | `server.js`, `tools/registerAll.js` |
| 06 | [Tools](./modules/06-tools.md) | every tool in `tools/` |
| 07 | [Security](./modules/07-security.md) | `policy.js`, `sqlValidator.js`, `rateLimit.js` |
| 08 | [Adapters](./modules/08-adapters.md) | `adapters/*`, `util/sqlDialect.js` |
| 09 | [Guardrails](./modules/09-guardrails.md) | `guardrails/*` |
| 10 | [Audit & observability](./modules/10-audit-and-observability.md) | `audit/`, `observability/`, `util/resultCap.js` |
| 11 | [Semantic layer](./modules/11-semantic.md) | `semantic/*` |
</content>
</invoke>
