# Module 02 — Configuration

> Expands on [Runbook §2.3 & §10 step 1](../runbook.md#23-composition-root--srcindexjs).
> File: [`src/util/config.js`](../../../src/util/config.js).

## Purpose

Turn raw environment variables into a **single typed, validated config object**, and expose a `ConfigProvider` abstraction so the rest of the system never reads `process.env` directly. Build this first — every other module depends on it.

## The three responsibilities

### 1. Parse + validate env — `loadConfig(env = process.env)`
Uses a **zod** schema (`BaseEnvSchema`) to coerce and default every variable. `z.coerce.number()` turns string env vars into numbers; `.default(...)` supplies safe fallbacks. Invalid values throw at boot — fail fast rather than at first request.

The flat env is reshaped into a **nested config object**:

```
{ transport, server{port,host,allowedOrigins}, auth{apiKeys,oidc},
  tenant{defaultTenantId}, safety{defaultLimit,hardMaxLimit,timeoutMs,
  maxResultCells,rateLimitRpm,auditFieldMaxBytes}, audit{dir,rotation},
  semantic{dir,defaultIncluded}, warehouse{...} }
```

### 2. Parse the two domain-specific mini-formats

- **`parseApiKeys(raw)`** → `Map<token, {role, warehouseRole?, includeSemantic?}>`. Format is comma-separated `token:role:opt=val:opt=val`. Options: `set_role=<wh role>` and `semantic=on|off`. **Backwards-compatible and forgiving**: unknown options are ignored silently, `semantic` is tri-state (on / off / absent) so a key can defer to the server default. Read the header comment before touching it — old key strings in the wild must keep parsing.
- **`buildWarehouseConfig(env)`** → a per-vendor connection object selected by `WAREHOUSE_TYPE`. Each `case` reads only that vendor's env vars (`PG_*`, `ORACLE_*`, `SNOWFLAKE_*`, …). Returns `null` when unconfigured (so `doctor` can report it cleanly instead of crashing).

### 3. The provider abstraction — `EnvConfigProvider`
A thin class wrapping the config with getters: `getWarehouseConfig(tenantId)`, `getApiKeys()`, `getOidcConfig()`, `getSafetyConfig()`, `getSemanticDefault()`. `getWarehouseConfig` merges `safety.timeoutMs` into the returned object so adapters can pass it straight to their drivers, and **throws for any tenant other than the configured one** (self-hosted v1 is single-tenant).

## Why it's built this way

- **Validate once, at the edge.** Downstream code trusts the config shape and never re-checks env. A bad config can only fail at boot.
- **`ConfigProvider` is a seam.** The SaaS variant will swap `EnvConfigProvider` for a tenant-aware store (DB/secret manager) **without touching a single call site** — tools, auth, and adapters only ever see `provider.getX()`. When you rewrite, preserve this seam even though v1 has one tenant.
- **Forgiving parsers, strict schema.** The env *schema* is strict (zod), but the *sub-formats* (`MCP_API_KEYS`) are forgiving so config authored for older versions keeps working.

## Gotchas

- `parseApiKeys` distinguishes "explicitly on", "explicitly off", and "absent" for `semantic` — don't collapse it to a boolean or you break the server-default fallback chain (see [module 03](./03-context-and-auth.md) for the precedence order).
- `buildWarehouseConfig` returns `null`, not throws, when `WAREHOUSE_TYPE` is unset — the throw is deferred to `getWarehouseConfig` so the server can still boot and serve `/health` and semantic-only sessions.

## Rewrite checklist
- [ ] One zod schema; coercion + defaults; throws on invalid.
- [ ] Flat env → nested config object with the sections above.
- [ ] `parseApiKeys` is backwards-compatible and tri-state for `semantic`.
- [ ] `buildWarehouseConfig` returns `null` when unconfigured.
- [ ] `ConfigProvider` getters are the *only* way other modules read config.

## See also
- Who constructs it → [module 01](./01-entry-and-bootstrap.md)
- Who reads `getApiKeys`/`getOidcConfig` → [module 03](./03-context-and-auth.md)
- Who reads `getWarehouseConfig` → [module 08](./08-adapters.md)
- Who reads `getSafetyConfig` → [module 05](./05-server-and-registration.md), [module 07](./07-security.md)
</content>
