# Postgres adapter

Read-only adapter for PostgreSQL 12+. Uses `pg` (node-postgres) with a connection pool.

## Required env

```
WAREHOUSE_TYPE=postgres
PG_HOST=db.internal
PG_PORT=5432
PG_DATABASE=analytics
PG_USER=mcp_reader
PG_PASSWORD=********
PG_SSL=true
```

`PG_SSL=true` enables TLS without certificate verification (suitable for self-signed certs and managed Postgres on private VPC). Set `PG_SSL=false` only for local dev.

## Recommended Postgres role

Grant the smallest privileges that work for this read-only adapter:

```sql
CREATE ROLE mcp_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE analytics TO mcp_reader;
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO mcp_reader;
```

Repeat for each schema you want exposed.

## What works in v1

- `query` (read-only enforced upstream by the SQL validator)
- `list_schemas`, `list_tables`, `describe_table`
- `sample_table`

## Gotchas

- Long-running connections sometimes get killed by managed Postgres (RDS, Neon). The pool transparently reconnects, but a tool call in flight at that moment will fail once and succeed on retry.
- `pg_temp_*` and `pg_toast_temp_*` schemas are filtered out automatically.
