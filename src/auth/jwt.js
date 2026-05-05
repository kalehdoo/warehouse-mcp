import { createRemoteJWKSet, jwtVerify } from "jose";

const _jwksCache = new Map();

function getJwks(issuer) {
  let jwks = _jwksCache.get(issuer);
  if (!jwks) {
    const url = new URL("/.well-known/jwks.json", issuer.endsWith("/") ? issuer : issuer + "/");
    jwks = createRemoteJWKSet(url);
    _jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/**
 * Verify a bearer JWT against an OIDC issuer's JWKS endpoint.
 * Returns the verified payload or throws.
 *
 * @param {string} token
 * @param {{issuer: string, audience: string}} oidc
 */
export async function verifyJwt(token, oidc) {
  const jwks = getJwks(oidc.issuer);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: oidc.issuer,
    audience: oidc.audience,
  });
  return payload;
}
