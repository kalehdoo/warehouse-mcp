# warehouse-mcp

Drop-in MCP (Model Context Protocol) server for your data warehouse. Read-only by default; ships safe SQL enforcement, bearer-token auth, and a JSONL audit log out of the box. Self-host the Docker image, or use the upcoming managed cloud variant.

> **Status:** v0.1.0 scaffolding. Real implementation lands in Phase 2 of the build plan.

## Supported warehouses (v1)

- Postgres
- Oracle (Thin mode — no Instant Client required)
- Redshift
- Snowflake
- BigQuery
- DuckDB (local demo / dev)

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
