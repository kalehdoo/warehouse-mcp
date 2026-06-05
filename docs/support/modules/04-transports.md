# Module 04 — Transports

> Expands on [Runbook §3](../runbook.md#3-the-two-transports--where-a-request-enters).
> Files: [`src/transport/stdio.js`](../../../src/transport/stdio.js), [`src/transport/http.js`](../../../src/transport/http.js).

## Purpose

Bridge an MCP client's wire protocol to a per-session `McpServer`. A transport's job is: accept a connection, establish a `Context`, call `buildServer(ctx, deps)`, and pump bytes. All the deps from [module 01](./01-entry-and-bootstrap.md) arrive here and are forwarded into `buildServer`.

## `stdio.js` — desktop clients (Claude Desktop, Cursor)

The simplest transport. Steps:
1. Synthesize an **`admin`** `Context` from the configured tenant (`makeContext`). No auth — the OS process boundary is the trust boundary (see [module 03](./03-context-and-auth.md)).
2. `buildServer(ctx, deps)` ([module 05](./05-server-and-registration.md)).
3. `server.connect(new StdioServerTransport())` and log readiness.

One process = one session = one server. Done.

## `http.js` — remote / multi-user deployments

A Node `http.createServer` handler that:

1. **CORS** via `applyCors` — reflects only origins in `config.server.allowedOrigins`; always allows credentials and the `mcp-session-id` header. `OPTIONS` short-circuits with `204`.
2. **`/health`** — returns `{status, server, version, warehouse, sessions}`. No auth; used by load balancers and `doctor`.
3. Routes only **`/mcp`**; everything else is `404`.
4. **Authenticate** via `authenticate(req, provider)` ([module 03](./03-context-and-auth.md)); on failure write the `auth.status` and `error`, log, and return.
5. **Session lookup/creation**:
   - If `mcp-session-id` header matches an existing session → reuse its `transport.handleRequest`.
   - Otherwise build a fresh `McpServer` bound to `auth.ctx` ([module 05](./05-server-and-registration.md)), wrap it in a `StreamableHTTPServerTransport`, and register it in the in-memory `sessions` Map on `onsessioninitialized`. `transport.onclose` deletes the session.
6. `server.listen(port, host)` and log the URL, health URL, whether auth is enabled, and the warehouse type.

### The session model — why fresh server per session
Each session gets **its own `McpServer` + its own `Context`** so role/tenant/principal flow through closures without globals (see [Runbook §4](../runbook.md#4-the-central-architectural-idea-per-session-server-bound-to-a-context)). Sessions live in an **in-memory `Map`** keyed by the generated `mcp-session-id`. This is correct for single-process self-hosted v1; the SaaS variant will need sticky routing or a shared session store across pods.

## Why it's built this way
- **Transports are thin.** They contain no tool logic and no security decisions beyond "authenticate, then delegate." All policy lives behind `buildServer`.
- **`/health` before auth** so infra can probe a server whose warehouse isn't configured yet.
- **Per-session isolation** means two users on the same deployment can hold different roles / semantic settings simultaneously.

## Gotchas
- The session id generator uses `Date.now()`/`Math.random()` — fine for a transport id, but **not** a security token; never treat session ids as auth.
- CORS reflects the request origin only when allow-listed; a missing/blocked origin still gets the other CORS headers but no `Access-Control-Allow-Origin`, which is the intended deny behavior for browsers.
- Closing a transport must remove it from `sessions` (the `onclose` loop) or you leak sessions.

## Rewrite checklist
- [ ] stdio synthesizes an admin context, no auth.
- [ ] HTTP: CORS → OPTIONS 204 → `/health` → route `/mcp` → authenticate → session reuse/create.
- [ ] Fresh `McpServer` + `Context` per new session; stored in a map keyed by session id.
- [ ] `onclose` deletes the session entry.
- [ ] `/health` works without auth and without a configured warehouse.

## See also
- The context they create → [module 03](./03-context-and-auth.md)
- What `buildServer` does next → [module 05](./05-server-and-registration.md)
- Where deps came from → [module 01](./01-entry-and-bootstrap.md)
</content>
