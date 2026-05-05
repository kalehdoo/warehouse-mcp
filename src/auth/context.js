/**
 * Per-request execution context.
 * Threaded through tool handlers, adapter factory, audit sink, and policy checks.
 *
 * @typedef {object} Context
 * @property {string} tenantId       Tenant identifier. Defaults to env TENANT_ID for self-hosted.
 * @property {string} role           Role string from API key or JWT claim. Used by policy.
 * @property {string} principal      Stable identity for audit logs (token suffix, JWT sub, or "anonymous").
 * @property {string} [requestId]    Optional correlation id for tracing.
 */

/**
 * Build a Context. Use this single factory so every code path yields the same shape.
 * @param {Partial<Context>} fields
 * @returns {Context}
 */
export function makeContext({ tenantId, role, principal, requestId } = {}) {
  return {
    tenantId: tenantId || "default",
    role: role || "anonymous",
    principal: principal || "anonymous",
    requestId: requestId || `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
  };
}
