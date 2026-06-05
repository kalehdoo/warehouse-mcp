# Module 07 — Security

> Expands on [Runbook §7](../runbook.md#7-the-security-boundary-the-never-writes-promise).
> Files: [`src/security/policy.js`](../../../src/security/policy.js), [`src/security/sqlValidator.js`](../../../src/security/sqlValidator.js), [`src/security/rateLimit.js`](../../../src/security/rateLimit.js).
>
> **This is the product.** The two files `policy.js` and `sqlValidator.js` are where the "never writes, never escapes its role" promise is enforced. Treat changes here as the highest-stakes in the codebase and give them the densest tests.

## `policy.js` — role-based tool authorization

Five tiers, defined as **nested supersets** so each tier inherits the one below:

```
semantic_only    → only the 3 semantic-lookup tools (no warehouse I/O at all)
metadata_only    → + schema/catalog discovery (never reads row data)
reader_restricted→ + aggregates / samples / time series (data only in aggregated/sampled form)
reader           → + arbitrary SELECT (query) and literal search (search_value)
admin            → everything (future write tools land here behind ENABLE_WRITE_TOOLS)
```

Each role maps to a `Set<toolName>` (`ROLE_TOOLS`). API:
- `isToolAllowed(role, toolName)` — used at **registration** to filter the catalog ([module 05](./05-server-and-registration.md)).
- `assertToolAllowed(ctx, toolName)` — throws; used **inside** the handler as defense in depth.
- `listToolsForRole(role)` / `VALID_ROLES` — introspection for `doctor` and tests.

> Why supersets: the tiers form a lattice, so a new tool is added to the lowest tier that should have it and automatically flows up. Read the header comment — it documents the *persona* behind each tier (e.g. `metadata_only` for compliance customers who must map the warehouse without seeing values; `semantic_only` as a docs-viewer for non-technical stakeholders).

## `sqlValidator.js` — read-only enforcement (load-bearing)

### `normalizeReadOnlySql(sql, {dialect, defaultLimit, maxLimit, maxUnions})`
The gate for **all user-supplied SQL** (the `query` tool). Steps, in order:
1. `stripSqlComments` — remove `/* */` and `--` so keywords can't hide in comments.
2. Split on `;`; **reject** anything that isn't exactly one statement (no statement chaining).
3. Require an **allowed prefix**: `SELECT / WITH / SHOW / DESCRIBE / DESC / EXPLAIN / PRAGMA`.
4. **Reject forbidden keywords** anywhere: `INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, MERGE, COPY, ATTACH, DETACH, EXPORT, CALL, VACUUM, GRANT, REVOKE, REPLACE`.
5. Reject `WITH RECURSIVE`; cap `UNION` count (`maxUnions`, default 2).
6. **Row cap**: detect an existing `LIMIT`/`FETCH FIRST`; reject if it exceeds `maxLimit`; reject `LIMIT` on Oracle. If none present (and not a `SHOW`/`PRAGMA`/etc.), wrap as `SELECT * FROM (<sql>) LIMIT n` — or Oracle's `FETCH FIRST n ROWS ONLY`.

### `assertReadOnly(sql)`
A lighter check used by tools that **build their own SQL** ([profile/search](./06-tools.md)) — just the forbidden-keyword scan, since dialect/limit handling already happened in the helper functions.

### `clipToolText(text, maxChars)`
Clips oversized tool output text (mirrors the original mcp-server behavior).

> The header comment says it outright: *"The validator is the safety boundary — any change here is load-bearing for the whole product."* Keyword matching is regex-on-uppercased-SQL — keep the forbidden list and the single-statement rule intact, and add tests for any new dialect quirk you introduce.

## `rateLimit.js` — `TokenBucketRateLimiter`

Per-principal token bucket: fills at `rpm/60` tokens/sec up to capacity `rpm`; each tool call costs one token; empty bucket → `RateLimitError` (with `retryAfterMs`). `charge()` is called at step 2 of the [pipeline](./05-server-and-registration.md). `MCP_RATE_LIMIT_RPM=0` disables it (no-op). In-memory and single-process — the SaaS variant needs a shared store (Redis) so multiple pods don't each grant a full bucket to the same key.

## Why it's built this way
- **Two layers of role enforcement** (registration filter + handler assert) so a future bug in one can't open the door.
- **Allow-list prefixes + deny-list keywords + single-statement + row cap** is belt-and-suspenders by design; SQL parsers are easy to fool, so the validator stacks multiple cheap, independent checks.
- **Fail-fast row caps** protect both memory and (on cloud warehouses) money.

## Gotchas
- The validator is regex-based, not a full SQL parser. That's intentional (robust, dependency-free) but means **the forbidden-keyword list and single-statement rule are the whole defense** — don't weaken them for convenience.
- Oracle has no `LIMIT`; the validator and `sqlDialect.limitClause` both special-case `FETCH FIRST`. Keep them in sync.
- Rate-limit state is per-process; don't assume global fairness in a multi-pod deploy.

## Rewrite checklist
- [ ] Five roles as nested supersets; `isToolAllowed` + `assertToolAllowed`.
- [ ] `normalizeReadOnlySql`: strip comments → single statement → allowed prefix → forbidden keywords → no recursive CTE → UNION cap → row cap (dialect-aware).
- [ ] `assertReadOnly` for generated SQL.
- [ ] Token-bucket rate limiter, per principal, `0` disables.
- [ ] Tests cover injection attempts, multi-statement, Oracle limit, over-max caps.

## See also
- Where `isToolAllowed` filters the catalog → [module 05](./05-server-and-registration.md)
- Who calls the validator → [module 06](./06-tools.md)
- Dialect-specific `limitClause` → [module 08](./08-adapters.md)
- `warehouseRole` (`SET ROLE`) as a second security layer → [module 08](./08-adapters.md)
</content>
