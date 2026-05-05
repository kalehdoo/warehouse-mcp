import { describe, it, expect } from "vitest";
import { authenticate } from "../../src/auth/bearer.js";

function makeProvider({ apiKeys = new Map(), oidc = null, tenantId = "default" } = {}) {
  return {
    config: { tenant: { defaultTenantId: tenantId } },
    getApiKeys: () => apiKeys,
    getOidcConfig: () => oidc,
  };
}

const req = (headers = {}) => ({ headers });

describe("authenticate", () => {
  it("returns admin context when auth is disabled (no keys, no OIDC)", async () => {
    const r = await authenticate(req(), makeProvider());
    expect(r.ok).toBe(true);
    expect(r.ctx.role).toBe("admin");
    expect(r.ctx.tenantId).toBe("default");
  });

  it("rejects missing Authorization header when keys are configured", async () => {
    const r = await authenticate(req(), makeProvider({ apiKeys: new Map([["k1", "reader"]]) }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it("rejects malformed Authorization header", async () => {
    const r = await authenticate(req({ authorization: "Token abc" }), makeProvider({ apiKeys: new Map([["k1", "reader"]]) }));
    expect(r.ok).toBe(false);
  });

  it("accepts a valid static API key and assigns its role", async () => {
    const provider = makeProvider({ apiKeys: new Map([["secret123456", "reader"]]) });
    const r = await authenticate(req({ authorization: "Bearer secret123456" }), provider);
    expect(r.ok).toBe(true);
    expect(r.ctx.role).toBe("reader");
    expect(r.ctx.principal).toMatch(/^key_/);
  });

  it("rejects an unknown bearer token", async () => {
    const provider = makeProvider({ apiKeys: new Map([["k1", "reader"]]) });
    const r = await authenticate(req({ authorization: "Bearer wrong" }), provider);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid/);
  });

  it("threads tenantId from provider into the Context", async () => {
    const provider = makeProvider({ apiKeys: new Map([["k", "admin"]]), tenantId: "acme" });
    const r = await authenticate(req({ authorization: "Bearer k" }), provider);
    expect(r.ctx.tenantId).toBe("acme");
  });
});
