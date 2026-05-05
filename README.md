# warehouse-mcp

Drop-in MCP (Model Context Protocol) server for your data warehouse. Read-only by default; ships safe SQL enforcement, bearer-token auth, and a JSONL audit log out of the box. Self-host the Docker image, or use the upcoming managed cloud variant.

> **Status:** v0.1.0. Server, adapters, tool handlers, CLI, Docker image, CI/release pipelines, threat model, and safety rails (rate limit, query timeout, result cap) are in place. Customer onboarding polish is the only thing left before tagging 1.0.

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

## Quick start

### Option A — Docker compose (5-minute demo with seeded Postgres)

```bash
git clone https://github.com/kalehdoo/warehouse-mcp.git
cd warehouse-mcp
docker compose up
# server on http://localhost:3001, seeded ecommerce data in Postgres
```

### Option B — Docker against your own warehouse

```bash
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=postgres \
  -e PG_HOST=… -e PG_DATABASE=… -e PG_USER=… -e PG_PASSWORD=… \
  -e MCP_API_KEYS="$(openssl rand -hex 24):reader" \
  ghcr.io/kalehdoo/warehouse-mcp:latest
```

### Option C — npx (no container)

```bash
npx warehouse-mcp@latest init     # interactive setup; writes .env, prints Claude Desktop snippet
npx warehouse-mcp doctor          # verify the connection without booting the server
npx warehouse-mcp start           # bind the MCP server to MCP_SERVER_PORT (default 3001)
```

Then point an AI client at it. Drop-in configs:
- [Claude Desktop](docs/install-claude-desktop.md)
- [Cursor](docs/install-cursor.md)
- [Docker (production)](docs/deploy-docker.md)
- [Kubernetes](docs/deploy-kubernetes.md)

## Local development

```bash
nvm use            # Node 20
npm install
npm test
npm run lint
cp .env.example .env
```

## Optional: OpenTelemetry tracing

Off by default. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces` in your env and the server will emit per-tool-call spans (resource attributes: `service.name=warehouse-mcp`, `service.version=0.1.0`; span attributes: `warehouse.tenant`, `warehouse.role`).

## Security

Read [docs/threat-model.md](docs/threat-model.md) before deploying. It covers the OWASP Top 10 mapping, what the codebase mitigates, and what is left to your deployment (TLS, secrets management, network isolation, cost guardrails). Report vulnerabilities via GitHub Security Advisory.

## License

Apache-2.0
