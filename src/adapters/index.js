import { createDuckDbAdapter } from "./duckdb.js";

/**
 * Per-tenant adapter pool. Self-hosted v1 has exactly one tenant, so the pool
 * has exactly one entry — but the API shape is what the SaaS multi-tenant
 * variant will use unchanged.
 */
const _pool = new Map();

function instantiate(config) {
  switch (config.type) {
    case "duckdb":
      return createDuckDbAdapter(config);
    case "postgres":
    case "redshift":
    case "oracle":
    case "snowflake":
    case "bigquery":
      throw new Error(
        `Adapter for '${config.type}' lands in Phase 3. Use WAREHOUSE_TYPE=duckdb for the v1 scaffold.`,
      );
    default:
      throw new Error(`Unknown warehouse type: ${config.type}`);
  }
}

/**
 * Get (or create) the adapter for the given context's tenant.
 * @param {{tenantId: string}} ctx
 * @param {{getWarehouseConfig: (tenantId: string) => object}} provider
 */
export function getAdapter(ctx, provider) {
  let adapter = _pool.get(ctx.tenantId);
  if (!adapter) {
    const config = provider.getWarehouseConfig(ctx.tenantId);
    adapter = instantiate(config);
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
