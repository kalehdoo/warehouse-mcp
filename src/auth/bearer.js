import { makeContext } from "./context.js";
import { verifyJwt } from "./jwt.js";

/**
 * Extract a Bearer token from a request's Authorization header.
 */
function extractBearer(headers) {
  const raw = headers["authorization"] || headers["Authorization"] || "";
  if (!raw.startsWith("Bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

/**
 * Authenticate an HTTP request and produce a Context.
 *
 * Resolution order:
 *  1. If neither static keys nor OIDC are configured → auth disabled, anonymous admin (dev-only).
 *  2. Static API key match → role from MCP_API_KEYS map.
 *  3. JWT verification against configured OIDC issuer (if enabled).
 *  4. Otherwise → 401.
 *
 * @param {object} req Node HTTP request (only headers are read).
 * @param {object} provider ConfigProvider instance.
 * @returns {Promise<{ok: true, ctx: import("./context.js").Context} | {ok: false, error: string, status: number}>}
 */
export async function authenticate(req, provider) {
  const apiKeys = provider.getApiKeys();
  const oidc = provider.getOidcConfig();
  const tenantId = provider.config.tenant.defaultTenantId;
  const authEnabled = apiKeys.size > 0 || Boolean(oidc);

  if (!authEnabled) {
    return {
      ok: true,
      ctx: makeContext({ tenantId, role: "admin", principal: "dev-anonymous" }),
    };
  }

  const token = extractBearer(req.headers);
  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer <token> header" };
  }

  const entry = apiKeys.get(token);
  if (entry) {
    // The map stores either a bare role string (legacy v0.1.x callers / tests)
    // or {role, warehouseRole} (v0.3+ format with optional impersonation).
    const role = typeof entry === "string" ? entry : entry.role;
    const warehouseRole = typeof entry === "string" ? undefined : entry.warehouseRole;
    return {
      ok: true,
      ctx: makeContext({
        tenantId,
        role,
        warehouseRole,
        principal: `key_${token.slice(-6)}`,
      }),
    };
  }

  if (oidc) {
    try {
      const claims = await verifyJwt(token, oidc);
      return {
        ok: true,
        ctx: makeContext({
          tenantId,
          role: claims.role || "reader_restricted",
          warehouseRole: claims.warehouse_role || undefined,
          principal: claims.sub || "jwt",
        }),
      };
    } catch (e) {
      return { ok: false, status: 401, error: `JWT verification failed: ${e.message}` };
    }
  }

  return { ok: false, status: 401, error: "Invalid API key" };
}
