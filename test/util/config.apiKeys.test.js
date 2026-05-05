import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/util/config.js";

let prev;

beforeEach(() => {
  prev = { ...process.env };
});

afterEach(() => {
  process.env = prev;
});

describe("MCP_API_KEYS parser", () => {
  it("parses bare key:role entries (legacy v0.1.x format)", () => {
    process.env.MCP_API_KEYS = "abc:reader,def:admin";
    const cfg = loadConfig();
    const map = cfg.auth.apiKeys;
    expect(map.size).toBe(2);
    expect(map.get("abc")).toEqual({ role: "reader" });
    expect(map.get("def")).toEqual({ role: "admin" });
  });

  it("parses key:role:set_role=warehouse_role entries", () => {
    process.env.MCP_API_KEYS = "abc:reader:set_role=alice,def:admin";
    const cfg = loadConfig();
    const map = cfg.auth.apiKeys;
    expect(map.get("abc")).toEqual({ role: "reader", warehouseRole: "alice" });
    expect(map.get("def")).toEqual({ role: "admin" });
  });

  it("ignores unknown options silently (forward-compat)", () => {
    process.env.MCP_API_KEYS = "abc:reader:future_option=bar:set_role=alice";
    const cfg = loadConfig();
    expect(cfg.auth.apiKeys.get("abc")).toEqual({ role: "reader", warehouseRole: "alice" });
  });

  it("skips malformed entries", () => {
    process.env.MCP_API_KEYS = "valid:reader,no_role,:emptykey,key:";
    const cfg = loadConfig();
    expect(cfg.auth.apiKeys.size).toBe(1);
    expect(cfg.auth.apiKeys.get("valid")).toEqual({ role: "reader" });
  });

  it("returns an empty map when MCP_API_KEYS is unset", () => {
    delete process.env.MCP_API_KEYS;
    const cfg = loadConfig();
    expect(cfg.auth.apiKeys.size).toBe(0);
  });
});
