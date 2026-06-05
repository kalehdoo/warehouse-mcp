# Module 08 — Adapters

> Expands on [Runbook §6](../runbook.md#6-the-adapter-layer--multi-warehouse-support).
> Files: [`src/adapters/index.js`](../../../src/adapters/index.js), [`types.js`](../../../src/adapters/types.js), [`errors.js`](../../../src/adapters/errors.js), [`postgres.js`](../../../src/adapters/postgres.js) (+ `redshift/oracle/snowflake/bigquery/duckdb`), and [`src/util/sqlDialect.js`](../../../src/util/sqlDialect.js).

## Purpose

Translate the generic, warehouse-agnostic requests from the [tools](./06-tools.md) into vendor-specific SQL and driver calls — and isolate every vendor quirk behind **one uniform interface** so the rest of the system never branches on warehouse type.

## `index.js` — the lazy adapter pool

- `_pool` is a `Map<tenantId, adapter>` — the **one piece of process-global mutable state** in the system.
- `ADAPTER_MODULES` maps each warehouse type to a **dynamic `import()`** thunk. A driver module is loaded **only when its type is selected**, so a Postgres deployment never pays Snowflake's ~150MB transitive AWS SDK cost.
- `getAdapter(ctx, provider)` — returns the cached adapter for `ctx.tenantId`, or instantiates it from `provider.getWarehouseConfig(tenantId)` and caches it.
- `closeAllAdapters()` — called by the shutdown handler ([module 01](./01-entry-and-bootstrap.md)); best-effort `close()` on each, then clears the pool.
- `_clearPoolForTests()` — test seam.

> Self-hosted v1 has exactly one tenant, so the pool has exactly one entry — but the API shape (`getAdapter(ctx, …)`) is what the SaaS multi-tenant variant uses unchanged. Don't collapse it to a single global adapter.

## `types.js` — the adapter contract

Every adapter exposes the same methods. Tools depend on this interface, never on a concrete adapter:

| Method | Returns |
|---|---|
| `query(sql, {warehouseRole})` | `{columns:[{name,type}], rows:[]}` |
| `listSchemas()` | `string[]` |
| `listTables(schema)` | `[{schema,name,kind}]` |
| `describeTable(schema, table)` | `[{name,type,nullable}]` |
| `sample(schema, table, n, {warehouseRole})` | like `query` |
| `findColumns(pattern, {schema})` | `[{schema,table,column,type}]` |
| `getForeignKeys({schema,table})` | edge rows |
| `getViewDefinition(schema, view)` | SQL string |
| `close()` | — |
| `type` | dialect string |

## `postgres.js` — the reference implementation (study this first)

- **Connection pooling** via `pg.Pool`, one pool per process per tenant; `statement_timeout`/`query_timeout` from `config.timeoutMs`.
- **`query(sql, opts)` has two paths**:
  - *No `warehouseRole`* → run directly on the pool (one round-trip).
  - *With `warehouseRole`* → check out a client, `SET ROLE "<role>"`, run the query, `RESET ROLE` in `finally`, release. **The `warehouseRole` is regex-validated** (`^[A-Za-z_][A-Za-z0-9_]*$`) before interpolation so it can't smuggle SQL even if upstream sanitization were bypassed.
- Catalog methods query `information_schema` with **parameterized** queries (`$1`, `$2`) and filter system schemas.
- `pgTypeName(oid)` maps common Postgres type OIDs to readable names without a system-table round-trip.
- Errors are wrapped via `errors.js` (`WarehouseError` / `wrapError`) into stable codes (`CONNECTION_FAILED`, `QUERY_FAILED`, `CATALOG_FAILED`, `NOT_FOUND`, `PERMISSION_DENIED`, `UNSUPPORTED`).

### `warehouseRole` — security pushed into the warehouse
`SET ROLE` makes the warehouse evaluate the query under an impersonated identity, so the warehouse's **own RLS / column masking / grants** enforce per-MCP-key access — without duplicating those policies in MCP. This is a second, independent security layer beneath [policy.js](./07-security.md). `redshift.js` reuses the Postgres adapter with a different `type`.

## `sqlDialect.js` — cross-dialect SQL helpers

Used by the [profile/search tools](./06-tools.md) when they construct SQL directly. One place to add a new dialect instead of touching every tool:
- `quoteIdent(name, dialect)` — double-quotes everywhere, **backticks for BigQuery**.
- `quoteLiteral(value)` — doubles single quotes, rejects NUL bytes.
- `limitClause(n, dialect)` — `LIMIT n` everywhere, **`FETCH FIRST n ROWS ONLY` for Oracle**.
- `qualifiedTable(schema, table, dialect)`.
- `isTextType` / `isNumericType` — regex heuristics for column-type classification.
- `dateTrunc(period, col, dialect)` — `DATE_TRUNC` (PG/Redshift/Snowflake/DuckDB), `TIMESTAMP_TRUNC` (BigQuery), `TRUNC(col,'fmt')` (Oracle); `TIME_PERIODS` is the allow-list.

## Why it's built this way
- **Lazy imports** keep memory and cold-start proportional to the *one* warehouse a deployment uses.
- **Uniform interface** means tools, security, and audit never branch on vendor — only adapters and `sqlDialect` know dialect details.
- **`WarehouseError` codes** give the audit log and the agent stable, non-leaky error categories.
- **Pool per tenant** is the seam for multi-tenancy.

## Gotchas
- Identifiers interpolated into SQL (including `warehouseRole`) must be validated/quoted — Postgres validates the role with a regex precisely because `SET ROLE` can't be parameterized.
- Oracle's lack of `LIMIT` ripples into both `sqlValidator.js` and `sqlDialect.limitClause` — keep them consistent.
- BigQuery quoting (backticks) and per-dataset `INFORMATION_SCHEMA` (schema often required) differ from the SQL-standard adapters.

## Rewrite checklist
- [ ] `_pool` keyed by tenant; drivers dynamically imported per type.
- [ ] Every adapter implements the full `types.js` interface and sets `type`.
- [ ] `query` supports the `warehouseRole` `SET ROLE`/`RESET ROLE` path with identifier validation.
- [ ] Catalog queries are parameterized; system schemas filtered.
- [ ] Errors wrapped into `WarehouseError` codes.
- [ ] New dialects added only in a new adapter + `sqlDialect.js`.

## See also
- Who calls `getAdapter` and the adapter methods → [module 06](./06-tools.md)
- Where the config comes from → [module 02](./02-config.md)
- `warehouseRole` origin (auth) → [module 03](./03-context-and-auth.md)
- Validator/dialect coupling → [module 07](./07-security.md)
- Pool shutdown → [module 01](./01-entry-and-bootstrap.md)
</content>
