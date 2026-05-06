# warehouse-mcp

[![CI](https://github.com/kalehdoo/warehouse-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kalehdoo/warehouse-mcp/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/kalehdoo/warehouse-mcp/blob/main/LICENSE)

Production MCP (Model Context Protocol) server for your data warehouse. Read-only enforcement, four-tier role-based access, optional warehouse-role impersonation (for native RLS / CLS), JSONL audit log, optional output PII masking. Self-host the Docker image, install via npx, or wait for the upcoming managed cloud variant.

> **Status:** v0.3.1 — production-ready for the v1 warehouse list. See [CHANGELOG](https://github.com/kalehdoo/warehouse-mcp/blob/main/CHANGELOG.md) for what shipped in each release.

## Supported warehouses

| Warehouse | Adapter docs |
|---|---|
| Postgres 12+ | [docs/adapters/postgres.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/postgres.md) |
| Oracle 12c+ (Thin mode, no Instant Client) | [docs/adapters/oracle.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/oracle.md) |
| Amazon Redshift (cluster + Serverless) | [docs/adapters/redshift.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/redshift.md) |
| Snowflake (key-pair auth) | [docs/adapters/snowflake.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/snowflake.md) |
| Google BigQuery | [docs/adapters/bigquery.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/bigquery.md) |
| DuckDB (local file or `:memory:`) | [docs/adapters/duckdb.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/duckdb.md) |
| MotherDuck (cloud-hosted DuckDB, `md:` paths) | [docs/adapters/duckdb.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/adapters/duckdb.md#motherduck-cloud-hosted-duckdb) |

Databricks SQL is a fast-follow.

## Tools exposed (13, all read-only)

| Tool | Purpose |
|---|---|
| `query` | Execute a SELECT (validator-enforced read-only, dialect-aware) |
| `list_schemas`, `list_tables`, `describe_table` | Browse the catalog |
| `find_columns` | Search column names across the warehouse with a LIKE pattern |
| `get_foreign_keys` | Discover declared FK relationships for safe joins |
| `get_view_definition` | Read the SQL body of a view (where business logic lives) |
| `sample_table`, `count_rows` | Peek at data, check size before scanning |
| `column_stats`, `top_values` | Profile a single column |
| `time_series` | Bucket by hour/day/week/month/quarter/year — dialect-correct everywhere |
| `search_value` | Find a literal across a table's text columns |

## Roles (four read tiers + admin)

| Role | Tools allowed |
|---|---|
| `metadata_only` | Catalog discovery only — never reads row data |
| `reader_restricted` | Aggregates / samples / time series — no arbitrary SELECT |
| `reader` | Adds `query` and `search_value` (the general analyst tier) |
| `admin` | Everything; future write tools when `ENABLE_WRITE_TOOLS` ships |

Per-key role assigned via `MCP_API_KEYS=key:role[:set_role=warehouse_role]`. The optional `set_role=` directive issues `SET ROLE` on Postgres/Redshift so the warehouse's own RLS / CLS / masking policies enforce per-key access — no policy duplication in MCP.

For deployments with multiple existing DB roles (finance, hr, payroll, etc.) and many human users, see [docs/multi-role-deployment.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/multi-role-deployment.md) — walks through mapping ~10 DB roles to MCP keys, the recommended `<area>` / `<area>_restricted` pattern, and when to graduate from static keys to OIDC.

## Quick start

### Option A — Docker compose (5-minute demo with seeded Postgres)

```bash
git clone https://github.com/kalehdoo/warehouse-mcp.git
cd warehouse-mcp
docker compose up
# server on http://localhost:3001, seeded ecommerce data in Postgres
```

### Option B — Docker against your own warehouse

The same image bundles every adapter; pick one with `WAREHOUSE_TYPE` plus the matching credentials. For credentials, prefer `--env-file` (or your secrets manager) over inline `-e` flags so passwords don't end up in shell history.

```bash
# Postgres (REDSHIFT_* env vars for Redshift; same driver under the hood)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=postgres \
  -e PG_HOST=db -e PG_DATABASE=analytics -e PG_USER=mcp_reader -e PG_PASSWORD=... \
  -e MCP_API_KEYS="$(openssl rand -hex 24):reader" \
  ghcr.io/kalehdoo/warehouse-mcp:latest

# Oracle (Thin mode, no Instant Client)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=oracle \
  -e ORACLE_USER=MCP_READER -e ORACLE_PASSWORD=... \
  -e ORACLE_CONNECT_STRING="db.host:1521/SERVICE" \
  ghcr.io/kalehdoo/warehouse-mcp:latest

# Snowflake (key-pair, mount the .p8)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=snowflake \
  -e SNOWFLAKE_ACCOUNT=xy12345.us-east-1 -e SNOWFLAKE_USER=MCP_READER \
  -e SNOWFLAKE_PRIVATE_KEY_PATH=/keys/snowflake.p8 \
  -e SNOWFLAKE_WAREHOUSE=COMPUTE_WH -e SNOWFLAKE_DATABASE=ANALYTICS \
  -v /opt/keys:/keys:ro \
  ghcr.io/kalehdoo/warehouse-mcp:latest

# BigQuery (mount the service-account JSON)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=bigquery \
  -e GOOGLE_APPLICATION_CREDENTIALS=/keys/bq-sa.json \
  -e BIGQUERY_PROJECT=my-gcp-project \
  -v /opt/keys:/keys:ro \
  ghcr.io/kalehdoo/warehouse-mcp:latest

# DuckDB (file or in-memory)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=duckdb -e DUCKDB_PATH=:memory: \
  ghcr.io/kalehdoo/warehouse-mcp:latest

# MotherDuck (hosted DuckDB)
docker run -d -p 3001:3001 \
  -e WAREHOUSE_TYPE=duckdb -e DUCKDB_PATH=md:my_database \
  -e MOTHERDUCK_TOKEN=... \
  ghcr.io/kalehdoo/warehouse-mcp:latest
```

### Option C — npx (no container)

```bash
npx warehouse-mcp@latest init     # interactive setup; writes .env, prints Claude Desktop snippet
npx warehouse-mcp doctor          # verify the connection without booting the server
npx warehouse-mcp start           # bind the MCP server to MCP_SERVER_PORT (default 3001)
```

Then point an AI client at it. Drop-in configs:
- [Claude Desktop](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/install-claude-desktop.md)
- [Cursor](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/install-cursor.md)
- [Docker (production)](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/deploy-docker.md)
- [Kubernetes](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/deploy-kubernetes.md)

For a step-by-step walkthrough from "I have a warehouse" to "Claude is querying it", see the [onboarding guide](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/onboarding.md). For common errors, see [troubleshooting](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/troubleshooting.md).

## Local development

```bash
nvm use            # Node 20
npm install
npm test           # unit tests, sub-second
npm run lint
cp .env.example .env
```

For testcontainers integration tests against real Postgres: `npm run test:integration` (Docker required).

## Optional: OpenTelemetry tracing

Off by default. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces` in your env and the server will emit per-tool-call spans. Resource attributes: `service.name=warehouse-mcp`, `service.version=<package.json version>`. Span attributes: `warehouse.tenant`, `warehouse.role`. Works with any OTLP/HTTP backend (Grafana Tempo, Honeycomb, Datadog APM, New Relic, SigNoz).

## Optional: Output PII masking

Off by default. Set `GUARDRAIL_PII_MASK=on` and the server masks emails, SSNs, formatted phones, IPv4 addresses, and Luhn-validated credit cards in result rows. Mask level depends on the caller's role: `admin` sees raw, `reader` sees partial (`a***@example.com`), `reader_restricted` sees full redaction tags.

## How it works

Read [the architecture doc](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/architecture.md) for the request flow — what files execute when an MCP client makes a call, how the guardrail pipeline composes around the tool handler, and the recipes for adding a new tool / guardrail / adapter. Single-page orientation for operators, security reviewers, and contributors.

## Security

Read [the threat model](https://github.com/kalehdoo/warehouse-mcp/blob/main/docs/threat-model.md) before deploying. It covers the OWASP Top 10 mapping, what the codebase mitigates, and what is left to your deployment (TLS, secrets management, network isolation, cost guardrails). Report vulnerabilities per [SECURITY.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/SECURITY.md).

## Contributing

Issues and PRs welcome. Start with [CONTRIBUTING.md](https://github.com/kalehdoo/warehouse-mcp/blob/main/CONTRIBUTING.md) — it covers the dev workflow, the adapter contract, and how to add a new warehouse. By participating you agree to the [Code of Conduct](https://github.com/kalehdoo/warehouse-mcp/blob/main/CODE_OF_CONDUCT.md).

## License

Apache-2.0
