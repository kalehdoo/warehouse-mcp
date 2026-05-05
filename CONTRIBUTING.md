# Contributing to warehouse-mcp

Thanks for your interest. This guide covers the dev workflow and the patterns the codebase expects.

## Prerequisites

- Node.js 20+ (`nvm use` will pick up `.nvmrc`)
- Docker Desktop (only required for integration tests; not for routine dev)
- Either a real warehouse or DuckDB for local testing

## Local setup

```bash
git clone https://github.com/kalehdoo/warehouse-mcp.git
cd warehouse-mcp
nvm use
npm install
cp .env.example .env
```

Edit `.env`. The fastest path is `WAREHOUSE_TYPE=duckdb` + `DUCKDB_PATH=:memory:` — no credentials needed.

Then:

```bash
npm test           # unit tests, ~300 ms
npm run lint
npm run dev        # node --watch src/index.js
```

## Branch + commit conventions

- Branch names: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`, `docs/<short-description>`.
- One logical change per commit. Commit messages should explain *why*, not just *what* — the diff already shows what.
- We do **not** add a Claude / AI coauthor trailer to commits.

## PR process

1. Open a PR against `main`. Keep it focused — small PRs review faster.
2. CI runs `npm run lint`, `npm test`, and a Docker image smoke. All three must pass before review.
3. Include a short test plan in the PR body (what you ran locally, what you verified).
4. If your change touches the warehouse adapter contract, run `npm run test:integration` locally and paste the output.
5. Update `CHANGELOG.md` under `[Unreleased]`.

## Adding a new warehouse adapter

The adapter contract is documented in [src/adapters/types.js](src/adapters/types.js). Existing adapters under [src/adapters/](src/adapters/) are reference implementations — copy the closest one and adjust.

Five steps to a new adapter:

1. **Pick a reference.** Postgres for SQL warehouses, BigQuery for REST-shaped APIs, DuckDB for in-process.
2. **Implement the contract**: `query`, `listSchemas`, `listTables`, `describeTable`, `sample`, `close`. Wrap every driver error in `WarehouseError` (`src/adapters/errors.js`).
3. **Register in the factory** ([src/adapters/index.js](src/adapters/index.js)) using a dynamic import so the driver loads only when its `WAREHOUSE_TYPE` is selected.
4. **Add catalog query for the dialect** to `src/util/sqlDialect.js` if it differs from existing patterns (Oracle's `FETCH FIRST` is the cautionary tale).
5. **Run the contract suite** against a real backend. Use testcontainers if a free image exists (Postgres, MariaDB, etc.); for cloud-only warehouses, gate the test behind credentials in nightly CI.

Update `docs/adapters/<name>.md` with the env vars and a recommended grants block.

## Code style

- ES modules everywhere. No CommonJS.
- Prefer pure functions; avoid module-level mutable state. Reason: the SaaS variant runs N tenants per process — globals will bite us.
- Use `WarehouseError` for anything customer-facing. Driver internals must not leak into MCP responses.
- Don't add a comment to explain *what* well-named code already says. Comment *why*: hidden constraints, surprising behavior, links to issues.

## Testing

- **Unit** (`npm test`): no Docker, no network. Fast (sub-second). Run constantly.
- **Integration** (`npm run test:integration`): testcontainers, opt-in. Run before opening PRs that touch adapters or the contract.
- **Smoke** (`docker compose up`): boots the seeded-Postgres demo. Useful when changing transports, auth, or the Dockerfile.

## Reporting bugs

Use the GitHub Issues template. Include:
- `warehouse-mcp doctor` output
- Logs from the affected request
- Minimal reproduction (env vars, SQL, steps)

## Reporting security issues

**Do not file a public issue for security bugs.** See [SECURITY.md](SECURITY.md).

## Code of conduct

By participating, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
