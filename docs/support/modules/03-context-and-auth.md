# Module 03 — Context & Authentication

> Expands on [Runbook §4.1 & §7.3](../runbook.md#41-the-context--srcauthcontextjs).
> Files: [`src/auth/context.js`](../../../src/auth/context.js), [`src/auth/bearer.js`](../../../src/auth/bearer.js), [`src/auth/jwt.js`](../../../src/auth/jwt.js).

## Purpose

Establish **who is making this request and what they may do**, as a single immutable `Context` object that flows through the entire request lifecycle. Authentication's only job is to *produce a `Context`*; everything else reads from it.

## `context.js` — the spine of the system

`makeContext({...})` is the **one factory** every code path uses, so the `Context` shape is identical everywhere. Fields:

| Field | Meaning |
|---|---|
| `tenantId` | Tenant identifier (defaults to `TENANT_ID`; one tenant in self-hosted v1). |
| `role` | MCP role: `semantic_only` / `metadata_only` / `reader_restricted` / `reader` / `admin`. Drives [policy](./07-security.md). |
| `principal` | Stable identity for audit (token suffix, JWT `sub`, or `dev-anonymous`). |
| `warehouseRole` | Optional warehouse-side role to impersonate via `SET ROLE` (Postgres/Redshift). |
| `includeSemantic` | Whether this session sees `warehouse://semantic/*` resources. |
| `requestId` | Correlation id for tracing. |

> **Why a factory and not a literal:** every transport, test double, and auth path must yield the *same* shape with the *same* defaults. Centralizing it means a new field is added in exactly one place. When you rewrite, never construct a context inline.

## `bearer.js` — `authenticate(req, provider)`

Reads only request **headers** and returns either `{ok:true, ctx}` or `{ok:false, status, error}`. Resolution order (precedence matters):

1. **Auth disabled** — if no static keys *and* no OIDC configured → anonymous `admin` with `principal: "dev-anonymous"`. **Dev-only**; never ship a production deployment with auth off.
2. **Static API key** — exact match in the `MCP_API_KEYS` map → role (and optional `warehouseRole`, `includeSemantic`) from the entry. Handles both the legacy bare-string form and the v0.3+ object form.
3. **JWT** — if OIDC is configured, verify the bearer token against the issuer; role/warehouse-role come from claims (`role`, `warehouse_role`, `include_semantic`), defaulting to `reader_restricted`.
4. **Otherwise** → `401`.

### The `includeSemantic` precedence chain
`semantic` resolves in this order: **per-key / per-JWT override → server default (`SEMANTIC_DEFAULT`)**. The tri-state parsing from [module 02](./02-config.md) is what makes "key explicitly says off" distinguishable from "key didn't say." Don't flatten it.

## `jwt.js` — OIDC verification
Uses **`jose`** to verify signature, issuer, and audience against the configured OIDC provider (typically via a remote JWKS). On any failure it throws; `bearer.js` converts that to a `401` with the reason. Treat verification failures as opaque to clients (don't leak why beyond "JWT verification failed").

## Trust-boundary asymmetry (important)
- **stdio** ([module 04](./04-transports.md)) does **not** authenticate — the OS process boundary is the trust boundary, so it synthesizes an `admin` context directly.
- **HTTP** authenticates **every** request before routing to `/mcp`.

This asymmetry is intentional and correct: a desktop user already controls the process; a network client does not.

## Rewrite checklist
- [ ] Single `makeContext` factory; no inline context literals anywhere.
- [ ] `authenticate` is pure over `(headers, provider)` and returns a tagged result, never throws to the caller.
- [ ] Resolution order: disabled → static key → JWT → 401.
- [ ] `includeSemantic` precedence: explicit override → server default.
- [ ] JWT verifies signature + issuer + audience; failures map to 401.

## See also
- Where contexts are created at the transport → [module 04](./04-transports.md)
- What `role` controls → [module 07](./07-security.md)
- Where `principal`/`role`/`warehouseRole` are logged → [module 10](./10-audit-and-observability.md)
- What `includeSemantic` gates → [module 11](./11-semantic.md)
</content>
