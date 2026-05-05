# Redshift adapter

Read-only adapter for Amazon Redshift (provisioned clusters and Serverless). Wire-compatible with PostgreSQL, so this adapter reuses the Postgres adapter under the hood with `type: "redshift"` for diagnostics and audit logs.

## Required env

```
WAREHOUSE_TYPE=redshift
REDSHIFT_HOST=my-cluster.abc123.us-east-1.redshift.amazonaws.com
REDSHIFT_PORT=5439
REDSHIFT_DATABASE=analytics
REDSHIFT_USER=mcp_reader
REDSHIFT_PASSWORD=********
REDSHIFT_SSL=true
```

For Redshift Serverless, the host looks like `my-workgroup.123456789012.us-east-1.redshift-serverless.amazonaws.com`.

## Recommended Redshift role

```sql
CREATE USER mcp_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO mcp_reader;
```

Repeat per schema you want exposed.

## What works in v1

Same surface as Postgres — `query`, `list_schemas`, `list_tables`, `describe_table`, `sample_table`. Catalog queries hit `information_schema`, which Redshift fully supports.

## Gotchas

- Redshift's `information_schema` returns external schemas (Spectrum) the same way as native ones, but querying their tables requires the underlying Glue / S3 permissions. The adapter doesn't filter them — so a user with limited Spectrum access will get a runtime error on `query`, not a clean catalog filter.
- Late-binding views describe with column types of `unknown` until the view is queried at least once. That's a Redshift quirk, not a bug here.
- Redshift drops idle connections aggressively (default 30s). The pool reconnects, but expect occasional cold-start latency on the first query after a quiet period.
