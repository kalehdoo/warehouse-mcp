# Changelog

All notable changes to warehouse-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — initial release

First end-to-end working version. Customers can install via Docker, npx, or directly from source, point an AI client at it, and run read-only analytical queries against any of the v1 warehouses.

### Added
- **MCP server core** built on `@modelcontextprotocol/sdk` v1, supporting both Streamable HTTP and stdio transports.
- **Six warehouse adapters**: Postgres, Oracle (Thin mode), Redshift, Snowflake (key-pair auth), BigQuery, DuckDB. Drivers are lazy-loaded — a Postgres-only deployment doesn't pay the Snowflake AWS-SDK cost.
- **Eight read-only tools**: `query`, `list_schemas`, `list_tables`, `describe_table`, `sample_table`, `column_stats`, `top_values`, `search_value`.
- **Dialect-aware SQL validator** that rejects writes, recursive CTEs, multi-statement bodies, and oversized row caps. Routes Oracle through `FETCH FIRST n ROWS ONLY` instead of `LIMIT`.
- **Bearer-key auth** with role-based tool authorization (`reader` / `admin`), plus optional OIDC JWT verification.
- **Tenant-aware execution context** threaded through transports → server → handlers, so the same code runs single-tenant self-hosted v1 and the planned SaaS multi-tenant variant.
- **CLI** with three subcommands: `init` (interactive setup wizard), `start` (boot the server), `doctor` (configuration diagnostics).
- **Docker image** (multi-stage, non-root, healthcheck) and `docker-compose.yml` demo with a seeded Postgres dataset.
- **GitHub Actions** for CI (lint + unit tests + image smoke) and release (signed image push to GHCR via cosign keyless, CycloneDX SBOM, drafted GitHub Release).
- **Safety rails**: per-principal token-bucket rate limit (`MCP_RATE_LIMIT_RPM`), per-warehouse query timeout (`QUERY_TIMEOUT_MS`), result cap on rows × columns (`QUERY_MAX_RESULT_CELLS`), audit log field clipping.
- **Optional OpenTelemetry** tracing — set `OTEL_EXPORTER_OTLP_ENDPOINT` and per-tool spans flow to your collector. SDK lazy-loaded so the cold path stays cheap.
- **JSONL audit log** with daily rotation, every record stamped with `tenant_id`, `principal`, `role`, `request_id`.
- **Documentation**: per-adapter env-var guides, install guides for Claude Desktop and Cursor, deploy guides for Docker and Kubernetes, threat model mapped to OWASP Top 10, troubleshooting + FAQ.
- **Testcontainers integration test** running the full WarehouseAdapter contract against real Postgres.

### Known limitations
- **Read-only only.** Write tools (`write_query`, `create_view`, `materialize_query`) are designed but gated behind a flag that ships in v2.
- **Single-tenant.** Multi-tenant interfaces are baked in; the SaaS control plane is a separate post-1.0 product.
- **Snowflake adapter holds a single long-lived connection.** Concurrent calls from one session serialize. Pool support is a v1.x concern.
- **No native query timeout for DuckDB.** Documented; affects only the local-demo path.
- **21 transitive npm vulnerabilities** from `snowflake-sdk`'s old AWS SDK chain. Tracked separately, not auto-fixed because forcing the update risks breaking known-good driver behavior.

[Unreleased]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kalehdoo/warehouse-mcp/releases/tag/v0.1.0
