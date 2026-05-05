# Oracle adapter

Read-only adapter for Oracle 12c+. Uses `oracledb` v6 in **Thin mode** (pure JS, no Instant Client).

## Required env

```
WAREHOUSE_TYPE=oracle
ORACLE_USER=MCP_READER
ORACLE_PASSWORD=********
ORACLE_CONNECT_STRING=db.internal:1521/ORCLPDB1
```

`ORACLE_CONNECT_STRING` accepts:
- Easy Connect: `host:port/service_name`
- Full TNS descriptor: `(DESCRIPTION=(ADDRESS=...)(CONNECT_DATA=...))`
- TNS alias (requires TNS_ADMIN to point at a tnsnames.ora)

## Autonomous DB / mTLS

For Oracle Autonomous Database or any deployment requiring a wallet:

```
ORACLE_WALLET_LOCATION=/opt/wallet
ORACLE_WALLET_PASSWORD=********
```

Place `cwallet.sso`, `ewallet.p12`, `tnsnames.ora`, and `sqlnet.ora` in that directory. Use the TNS alias from `tnsnames.ora` as `ORACLE_CONNECT_STRING`.

## Recommended Oracle role

```sql
CREATE USER mcp_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO mcp_reader;
-- Per-schema, per-table:
GRANT SELECT ON sales.orders TO mcp_reader;
-- Or whole schema:
GRANT SELECT ANY TABLE TO mcp_reader;  -- broader; review with security
```

## What works in v1

- `query` (validator routes Oracle through `FETCH FIRST n ROWS ONLY`; raw `LIMIT` is rejected)
- `list_schemas` (filters out system users via `ALL_USERS.ORACLE_MAINTAINED='N'` on 12c+)
- `list_tables`, `describe_table`, `sample_table`

## Gotchas

- Oracle has no `LIMIT`. The MCP layer's SQL validator rewrites `SELECT * FROM ...` into `SELECT * FROM (...) FETCH FIRST n ROWS ONLY`. If a user passes literal `LIMIT 5`, the call is rejected with a helpful error.
- Schema names are case-sensitive in `ALL_TABLES` and uppercase by default. Pass them as-is — `MCP_READER`, not `mcp_reader`.
- Thin mode does not yet support every Oracle feature (advanced queuing, sharding). For v1 read-only catalog + query, Thin mode is sufficient. If you hit a feature gap, switch to Thick mode by installing Oracle Instant Client and calling `oracledb.initOracleClient()` early — not needed for the v1 surface.
