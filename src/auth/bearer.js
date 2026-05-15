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
  // Server-wide default. Older providers (test doubles, etc.) won't define
  // the getter — treat that as "on" so legacy callers keep working.
  const semanticDefault =
    typeof provider.getSemanticDefault === "function" ? provider.getSemanticDefault() : true;
  const authEnabled = apiKeys.size > 0 || Boolean(oidc);

  if (!authEnabled) {
    return {
      ok: true,
      ctx: makeContext({
        tenantId,
        role: "admin",
        principal: "dev-anonymous",
        includeSemantic: semanticDefault,
      }),
    };
  }

  const token = extractBearer(req.headers);
  if (!token) {
    return { ok: false, status: 401, error: "Missing Authorization: Bearer <token> header" };
  }

  const entry = apiKeys.get(token);
  if (entry) {
    // The map stores either a bare role string (legacy v0.1.x callers / tests)
    // or {role, warehouseRole, includeSemantic} (v0.3+ format).
    const role = typeof entry === "string" ? entry : entry.role;
    const warehouseRole = typeof entry === "string" ? undefined : entry.warehouseRole;
    const keyOverride = typeof entry === "string" ? undefined : entry.includeSemantic;
    return {
      ok: true,
      ctx: makeContext({
        tenantId,
        role,
        warehouseRole,
        includeSemantic: keyOverride === undefined ? semanticDefault : keyOverride,
        principal: `key_${token.slice(-6)}`,
      }),
    };
  }

  if (oidc) {
    try {
      const claims = await verifyJwt(token, oidc);
      const jwtOverride =
        typeof claims.include_semantic === "boolean" ? claims.include_semantic : undefined;
      return {
        ok: true,
        ctx: makeContext({
          tenantId,
          role: claims.role || "reader_restricted",
          warehouseRole: claims.warehouse_role || undefined,
          includeSemantic: jwtOverride === undefined ? semanticDefault : jwtOverride,
          principal: claims.sub || "jwt",
        }),
      };
    } catch (e) {
      return { ok: false, status: 401, error: `JWT verification failed: ${e.message}` };
    }
  }

  return { ok: false, status: 401, error: "Invalid API key" };
}
