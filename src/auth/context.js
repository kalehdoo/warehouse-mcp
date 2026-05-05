/**
 * Per-request execution context.
 * Threaded through tool handlers, adapter factory, audit sink, guardrail
 * pipeline, and policy checks.
 *
 * @typedef {object} Context
 * @property {string} tenantId         Tenant identifier. Defaults to env TENANT_ID for self-hosted.
 * @property {string} role             MCP role from API key or JWT claim
 *                                     (`metadata_only` | `reader_restricted` | `reader` | `admin`).
 * @property {string} principal        Stable identity for audit logs
 *                                     (token suffix, JWT sub, or `dev-anonymous`).
 * @property {string} [warehouseRole]  Optional warehouse-side role to impersonate via
 *                                     `SET ROLE` (Postgres/Redshift). Lets warehouse-native
 *                                     RLS / CLS / masking policies enforce per-MCP-key access
 *                                     without duplicating them in MCP.
 * @property {string} [requestId]      Optional correlation id for tracing.
 */

/**
 * Build a Context. Use this single factory so every code path yields the same shape.
 * @param {Partial<Context>} fields
 * @returns {Context}
 */
export function makeContext({ tenantId, role, principal, warehouseRole, requestId } = {}) {
  return {
    tenantId: tenantId || "default",
    role: role || "admin",
    principal: principal || "dev-anonymous",
    warehouseRole: warehouseRole || undefined,
    requestId:
      requestId ||
      `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
}
