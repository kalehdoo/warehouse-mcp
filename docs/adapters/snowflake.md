# Snowflake adapter

Read-only adapter for Snowflake using the official `snowflake-sdk`.

## Required env

```
WAREHOUSE_TYPE=snowflake
SNOWFLAKE_ACCOUNT=xy12345.us-east-1
SNOWFLAKE_USER=MCP_READER
SNOWFLAKE_PRIVATE_KEY_PATH=/opt/keys/snowflake_rsa.p8
SNOWFLAKE_WAREHOUSE=COMPUTE_WH
SNOWFLAKE_DATABASE=ANALYTICS
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_ROLE=MCP_READER_ROLE
```

`SNOWFLAKE_ACCOUNT` is the account identifier from your Snowflake URL — for `https://xy12345.us-east-1.snowflakecomputing.com`, the value is `xy12345.us-east-1`.

## Auth: key-pair only

V1 supports **only** key-pair authentication — Snowflake is deprecating password auth, and we never want to ship a product that encourages stuffing passwords in env vars.

Create the key pair on your laptop:

```bash
openssl genrsa -out snowflake_rsa.pem 2048
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in snowflake_rsa.pem -out snowflake_rsa.p8
openssl rsa -in snowflake_rsa.pem -pubout -out snowflake_rsa.pub
```

Then in Snowflake:

```sql
ALTER USER mcp_reader SET RSA_PUBLIC_KEY='<contents of snowflake_rsa.pub, no header lines>';
```

Point `SNOWFLAKE_PRIVATE_KEY_PATH` at the `.p8` file. The adapter reads it once at connection time.

## Recommended Snowflake grants

```sql
CREATE ROLE mcp_reader_role;
GRANT USAGE ON WAREHOUSE compute_wh TO ROLE mcp_reader_role;
GRANT USAGE ON DATABASE analytics TO ROLE mcp_reader_role;
GRANT USAGE ON SCHEMA analytics.public TO ROLE mcp_reader_role;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics.public TO ROLE mcp_reader_role;
GRANT SELECT ON FUTURE TABLES IN SCHEMA analytics.public TO ROLE mcp_reader_role;
GRANT ROLE mcp_reader_role TO USER mcp_reader;
```

## What works in v1

- `query`, `list_schemas`, `list_tables`, `describe_table`
- `sample_table` uses `SAMPLE (n ROWS)` — fast, statistically biased toward the first micro-partitions but fine for spot checks

## Gotchas

- Connections are single-use in v1. Concurrent tool calls from the same session serialize. If you need parallelism, that's a v2 concern.
- The `SNOWFLAKE_WAREHOUSE` setting controls compute cost. Use the smallest `XS` warehouse and let auto-suspend handle idle time. The adapter doesn't auto-resume — Snowflake does that on first query.
- Watch your credit consumption. There are no built-in cost guardrails in this adapter; pair it with Snowflake's resource monitors.
