# warehouse-mcp

Drop-in MCP (Model Context Protocol) server for your data warehouse. Read-only by default; ships safe SQL enforcement, bearer-token auth, and a JSONL audit log out of the box. Self-host the Docker image, or use the upcoming managed cloud variant.

> **Status:** v0.1.0. Server core, transports, security, and warehouse adapters are in place. Tool handlers (Phase 4) and CLI (Phase 5) are next.

## Supported warehouses (v1)

| Warehouse | Adapter docs |
|---|---|
| Postgres 12+ | [docs/adapters/postgres.md](docs/adapters/postgres.md) |
| Oracle 12c+ (Thin mode, no Instant Client) | [docs/adapters/oracle.md](docs/adapters/oracle.md) |
| Amazon Redshift (cluster + Serverless) | [docs/adapters/redshift.md](docs/adapters/redshift.md) |
| Snowflake (key-pair auth) | [docs/adapters/snowflake.md](docs/adapters/snowflake.md) |
| Google BigQuery | [docs/adapters/bigquery.md](docs/adapters/bigquery.md) |
| DuckDB (local demo / dev) | [docs/adapters/duckdb.md](docs/adapters/duckdb.md) |

Databricks SQL is a fast-follow.

## Tools exposed (v1, all read-only)

`query`, `list_schemas`, `list_tables`, `describe_table`, `sample_table`, `column_stats`, `top_values`, `search_value`.

## Quick start (post-1.0; not wired yet)

```bash
npx warehouse-mcp@latest init
npx warehouse-mcp start
```

## Local development

```bash
nvm use            # Node 20
npm install
npm test
npm run lint
cp .env.example .env
```

## License

Apache-2.0
