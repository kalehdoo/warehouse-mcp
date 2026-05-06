# Changelog

All notable changes to warehouse-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.4] — 2026-05-06

Re-publish of v0.3.3 with the schema-corrected `server.json`. The 0.3.3 npm publish shipped a `server.json` with two schema violations (description over 100 chars, and `transport.type: "http"` instead of the valid `"streamable-http"`) that were caught by `mcp-publisher validate` after the fact. The fix landed on main but didn't get tagged before npm 0.3.3 was published. Since npm versions are immutable, this bumps to 0.3.4 so the registry-publishable `server.json` is in a tagged release.

### Changed
- `package.json` and `server.json` versions → 0.3.4 to match this tag.

### Notes
- `warehouse-mcp@0.3.3` on npm is functionally fine — `npx warehouse-mcp` users are unaffected. Only the `mcp-publisher publish` path against 0.3.3 would fail. 0.3.4 is the first version with a registry-valid `server.json` baked in.
- Verified locally with `mcp-publisher validate`: ✅ server.json is valid.

## [0.3.3] — 2026-05-06

Distribution / discoverability release. No behavior changes. Adds the metadata needed to publish to the official MCP Registry at registry.modelcontextprotocol.io so AI clients can discover warehouse-mcp through their built-in server pickers.

### Added
- **`mcpName: "io.github.kalehdoo/warehouse-mcp"`** in package.json — required by the MCP Registry to bind the npm package to its server entry. The `io.github.<owner>/` namespace ties registry ownership to GitHub auth.
- **`server.json`** — registry manifest declaring two install paths (npm + stdio for desktop AI clients, OCI/Docker + HTTP for deployed servers), plus environment-variable documentation for every supported warehouse with `isRequired` / `isSecret` flags. ~200 lines.

### Changed
- `package.json` version → 0.3.3 to match this tag.

### Notes
- After this version is published to npm, the maintainer runs `mcp-publisher login` then `mcp-publisher publish` against `server.json` to push the registry entry. The registry validates that `server.json`'s `name` matches the npm package's `mcpName` field, which proves package ownership.
- Schema URL pinned to `2025-12-11` — the version frozen for the v0.1 API freeze that started 2025-10-24. May need a bump when the registry exits preview to GA.

## [0.3.2] — 2026-05-06

Tooling release. No behavior changes; ships a guardrail in the release workflow plus the npm-publish prep that should have landed in v0.3.1.

### Added
- **Tag/version-mismatch guard in `release.yml`** — fails the workflow fast if the git tag doesn't match the `version` in `package.json`. Catches the v0.1.3-tag-but-package-says-0.3.1 mistake from the first publish before any minutes are spent on docker build / cosign / SBOM. Compares `node -p "require('./package.json').version"` to the parsed tag and exits 1 with a clear remediation message if they disagree.

### Changed
- `package.json` version → 0.3.2 to match this tag.

### Notes
- v0.3.1 was published to npm under git tag `v0.1.3` due to a tag/package mismatch. The published bits are correct (the 0.3.1 code); only the git tag name is misleading. The new guard prevents this class of mistake going forward.

## [0.3.0] — 2026-05-05

Adds the **guardrail pipeline** as load-bearing infrastructure for layered security, plus the first guardrail (output PII masking), a **four-tier role model**, and **warehouse-role impersonation** so the warehouse's own RLS / CLS / masking policies do their job under the right identity.

### Added
- **`src/guardrails/`** — pipeline runner (`runPre` / `runPost`), Guardrail interface, structured `GuardrailEvent` records that flow into the audit log. Guardrails are independent modules gated on individual env knobs; new layers plug in without touching tool handlers. Fail-closed semantics on pre-guardrail bugs (deny rather than slip through), fail-open on post-guardrail bugs (skip the transformer rather than poison the response).
- **`outputPiiMask`** post-guardrail — role-aware redaction of result rows. Detects emails, SSNs, phones (formatted only — no false positives on raw digit strings), IPv4 addresses, and Luhn-validated credit cards. `admin` sees raw data, `reader` sees partial masks (`a***@example.com`), `reader_restricted` sees full redaction tags. Off by default; enable with `GUARDRAIL_PII_MASK=on`.
- **Four-tier role model** (`src/security/policy.js`):
  - `metadata_only` — catalog discovery only, never reads row data
  - `reader_restricted` — aggregates / samples / time series, no arbitrary SELECT
  - `reader` — adds `query` and `search_value` (the v0.2.x "reader" tier)
  - `admin` — everything
- **Warehouse-role impersonation** for Postgres and Redshift. API key syntax extended to `key:role:set_role=<warehouse_role>`. The adapter checks out a pool client, issues `SET ROLE`, runs the user query, then `RESET ROLE`. Warehouse-side RLS / CLS / masking now enforce per-MCP-key access without duplicating policy in MCP.
- **API key parser** now returns `{role, warehouseRole}` instead of a bare role string. Backwards-compatible: bare `key:role` entries still parse correctly.
- **GuardrailEvent records** in the audit log — structured JSON describing each guardrail's action (`allow` / `deny` / `approve_required` / `transform`) so SIEM tools can alert on patterns.
- Identifier-validation guard rejects SQL-injection attempts in the `warehouseRole` field (`^[A-Za-z_][A-Za-z0-9_]*$`).
- Threat model updated with a new "Defense in depth: guardrail pipeline" section and a new "Defense in depth: warehouse-role impersonation" section.

### Changed
- `Context.role` defaults are tightened: `dev-anonymous` admin (no auth configured) is the only path that grants admin without an explicit `MCP_API_KEYS` entry.
- Catalog tools (`listSchemas`, `listTables`, `describeTable`, `findColumns`, `getForeignKeys`, `getViewDefinition`) intentionally do **not** honor `warehouseRole` — they read from `information_schema` which doesn't carry RLS in any of our supported warehouses. Data-reading tools (`query`, `sample_table`, `column_stats`, `top_values`, `time_series`, `search_value`, `count_rows`) all thread it through.

### Architectural notes (deliberate non-features)
- **Prompt injection detection** and **input PII redaction** are not in this release and never will be: warehouse-mcp doesn't see the LLM prompt, only the tool call the LLM produced. Detection at this layer would be security theater. Those concerns belong in the AI client (Claude Desktop, Cursor, custom agent).
- **Sensitive-table policy at the MCP layer** is deferred. Customers should use warehouse-side RLS + the new `set_role=` impersonation instead. Will revisit only if a customer specifically can't (or won't) configure warehouse-side controls.
- **Approval-required signal** is wired into the pipeline (a guardrail can return `approve_required` and it surfaces to the caller) but no guardrail emits it yet. Will land when a customer asks for the use case.

### Tests
- 122/122 unit tests pass (97 → 122, +25 new across roles, API key parser, pipeline, PII mask).
- 13/13 integration tests pass against real Postgres via testcontainers, including 5 new impersonation tests proving warehouse-side RLS actually fires under the impersonated role and that `RESET ROLE` runs even on error paths.

## [0.2.0] — 2026-05-05

Adds five tools that turn the agent from "can run SQL you give it" into "can navigate an unfamiliar warehouse on its own." Existing tool surface unchanged; this is purely additive — no breaking changes for clients pinned to 0.1.x.

### Added
- **`find_columns`** — search column names across the warehouse with a SQL LIKE pattern. Answers *"where is `customer_email` stored?"* in one round-trip instead of N × `describe_table`.
- **`count_rows`** — single `COUNT(*)` for a table. Cheap; lets the agent decide whether to `sample_table` or `query` based on actual size. Saves real money on per-byte cloud warehouses.
- **`get_foreign_keys`** — declared FK relationships. The agent can now construct correct JOINs without guessing.
- **`get_view_definition`** — return the SQL body of a view. In real warehouses, business logic lives in views; the agent couldn't reason about them before.
- **`time_series`** — group by date column into hour/day/week/month/quarter/year buckets, count or aggregate per bucket. Dialect-correct everywhere — `DATE_TRUNC` / `TIMESTAMP_TRUNC` / `TRUNC` chosen automatically. Saves the agent from generating per-warehouse date SQL.
- New `dateTrunc()` helper in `src/util/sqlDialect.js` for any future tool that needs time bucketing.
- New `WarehouseAdapter` contract methods: `findColumns`, `getForeignKeys`, `getViewDefinition`. Implemented across all six adapters.

### Notes
- BigQuery's `find_columns` and `get_foreign_keys` require a schema (dataset) because `INFORMATION_SCHEMA` is per-dataset there. Project-wide search would mean iterating every dataset — out of scope for v0.2.
- DuckDB's foreign-key reflection assumes the referenced schema equals the from-schema (DuckDB's `duckdb_constraints()` doesn't surface it).
- Reader role can invoke all five new tools (still no admin-only tools).

## [0.1.1] — 2026-05-05

### Added
- **MotherDuck cloud support** via the existing DuckDB adapter. Set `DUCKDB_PATH=md:<database_name>` and `MOTHERDUCK_TOKEN=<service-token>` to point the server at a MotherDuck-hosted database. The DuckDB driver auto-installs the `motherduck` extension on first connect; no new npm dependency. See [docs/adapters/duckdb.md](docs/adapters/duckdb.md).

### Changed
- **README docker matrix consolidated.** The "Docker against your own warehouse" section now shows a single fenced `bash` block covering all six warehouses (Postgres, Oracle, Snowflake, BigQuery, DuckDB, plus the Redshift note) instead of one example.

### Fixed
- **Release workflow's cosign step** was iterating per-tag with an interpolation that broke on the multi-line output of `docker/metadata-action` (newlines in the bash `for` loop). Cosign signatures attach to the digest and verify against any tag pointing at it, so we now sign once per build. Caught on the v0.1.0 release run.

### Security
- **`/secrets/` directory now in `.gitignore`** (root-anchored). Companion to the supported pattern of keeping per-warehouse env-file templates under `secrets/` for `--env-file` use. The leading `/` ensures `src/audit/`-style overmatches don't recur.

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

[Unreleased]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.3.4...HEAD
[0.3.4]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.3.0...v0.3.2
[0.3.0]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/kalehdoo/warehouse-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kalehdoo/warehouse-mcp/releases/tag/v0.1.0
