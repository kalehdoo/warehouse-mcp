/**
 * Per-tenant adapter pool with lazy driver loading.
 *
 * Each warehouse driver (pg, oracledb, snowflake-sdk, @google-cloud/bigquery,
 * duckdb) is heavy — Snowflake's transitive AWS SDK alone adds ~150MB of
 * resident memory. We import the adapter module only when its WAREHOUSE_TYPE
 * is selected, so a Postgres-only deployment never pays the Snowflake cost.
 *
 * Self-hosted v1 has exactly one tenant, so the pool has exactly one entry —
 * but the API shape is what the SaaS multi-tenant variant will use unchanged.
 */
import { WarehouseError } from "./errors.js";

const _pool = new Map();

const ADAPTER_MODULES = {
  duckdb: () => import("./duckdb.js").then((m) => m.createDuckDbAdapter),
  postgres: () => import("./postgres.js").then((m) => m.createPostgresAdapter),
  redshift: () => import("./redshift.js").then((m) => m.createRedshiftAdapter),
  oracle: () => import("./oracle.js").then((m) => m.createOracleAdapter),
  snowflake: () => import("./snowflake.js").then((m) => m.createSnowflakeAdapter),
  bigquery: () => import("./bigquery.js").then((m) => m.createBigQueryAdapter),
};

async function instantiate(config) {
  const loader = ADAPTER_MODULES[config.type];
  if (!loader) {
    throw new WarehouseError(
      "UNSUPPORTED",
      `Unknown warehouse type: ${config.type}`,
      { warehouse: config.type },
    );
  }
  const factory = await loader();
  return factory(config);
}

/**
 * Get (or create) the adapter for the given context's tenant.
 * @param {{tenantId: string}} ctx
 * @param {{getWarehouseConfig: (tenantId: string) => object}} provider
 * @returns {Promise<import("./types.js").WarehouseAdapter>}
 */
export async function getAdapter(ctx, provider) {
  let adapter = _pool.get(ctx.tenantId);
  if (!adapter) {
    const config = provider.getWarehouseConfig(ctx.tenantId);
    adapter = await instantiate(config);
    _pool.set(ctx.tenantId, adapter);
  }
  return adapter;
}

export async function closeAllAdapters() {
  for (const adapter of _pool.values()) {
    try {
      await adapter.close?.();
    } catch {
      // best effort
    }
  }
  _pool.clear();
}

/** Test-only: clear the pool without closing (avoids dangling driver state in tests). */
export function _clearPoolForTests() {
  _pool.clear();
}

export const SUPPORTED_WAREHOUSES = Object.keys(ADAPTER_MODULES);
