/**
 * Shared scaffolding for tool-handler tests. Each test gets a fresh in-memory
 * DuckDB adapter via the real factory pool (not a mock), so the same code path
 * runs that production uses.
 */
import { getAdapter, closeAllAdapters, _clearPoolForTests } from "../../src/adapters/index.js";

export function makeCtx(overrides = {}) {
  return {
    tenantId: "default",
    role: "admin",
    principal: "test",
    requestId: "req_test",
    ...overrides,
  };
}

export function makeProvider() {
  return {
    config: { tenant: { defaultTenantId: "default" } },
    getWarehouseConfig: () => ({ type: "duckdb", path: ":memory:" }),
    getApiKeys: () => new Map(),
    getOidcConfig: () => null,
    getSafetyConfig: () => ({
      defaultLimit: 1000,
      hardMaxLimit: 10000,
      timeoutMs: 30000,
    }),
  };
}

/**
 * Spin up a fresh DuckDB adapter behind the real factory, seed it with the
 * canonical demo dataset, return everything a handler needs.
 *
 * Demo data: demo.widgets(id INT, name VARCHAR, color VARCHAR, price DOUBLE)
 *   5 rows; colors red(2)/blue(2)/green(1) for top_values + search assertions.
 */
export async function setupDemo() {
  _clearPoolForTests();
  const provider = makeProvider();
  const ctx = makeCtx();
  const adapter = await getAdapter(ctx, provider);
  await adapter.query(`CREATE SCHEMA IF NOT EXISTS demo`);
  await adapter.query(
    `CREATE TABLE demo.widgets (id INTEGER, name VARCHAR, color VARCHAR, price DOUBLE)`,
  );
  await adapter.query(
    `INSERT INTO demo.widgets VALUES
       (1,'alpha','red',1.5),
       (2,'beta','blue',2.5),
       (3,'gamma','red',3.5),
       (4,'delta','blue',4.5),
       (5,'epsilon','green',5.5)`,
  );
  return { provider, ctx, adapter, deps: { provider, audit: undefined } };
}

export async function teardown() {
  await closeAllAdapters();
}
