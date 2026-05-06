/**
 * Verifies that registerAllTools only registers tools the caller's role is
 * allowed to invoke. With this in place, tools/list (which the SDK derives
 * from registered tools) returns a role-filtered catalog instead of the
 * full set. Caught a real UX issue in v0.4.1 where Claude Desktop showed
 * 13 tools to a metadata_only session even though only 6 were callable.
 */
import { describe, it, expect } from "vitest";
import { registerAllTools } from "../../src/tools/registerAll.js";
import { listToolsForRole, VALID_ROLES } from "../../src/security/policy.js";

/**
 * Spy implementation of the bits of McpServer that registerAllTools touches.
 * Avoids spinning up a real MCP server just to count registrations.
 */
function makeSpyServer() {
  const registrations = [];
  return {
    registrations,
    registerTool(name, _config, _handler) {
      registrations.push(name);
    },
  };
}

const ctx = (role) => ({
  tenantId: "default",
  role,
  principal: "test",
  requestId: "req_test",
});

describe("registerAllTools — role-filtered registration", () => {
  it("admin sees every tool", () => {
    const server = makeSpyServer();
    registerAllTools(server, ctx("admin"));
    const expected = listToolsForRole("admin").sort();
    expect(server.registrations.sort()).toEqual(expected);
  });

  it("reader registers only the reader tier (no future write tools)", () => {
    const server = makeSpyServer();
    registerAllTools(server, ctx("reader"));
    const allowed = new Set(listToolsForRole("reader"));
    for (const name of server.registrations) {
      expect(allowed.has(name)).toBe(true);
    }
    // And no admin-only tools sneak through
    expect(server.registrations).toContain("query");
    expect(server.registrations).toContain("search_value");
  });

  it("reader_restricted excludes query and search_value", () => {
    const server = makeSpyServer();
    registerAllTools(server, ctx("reader_restricted"));
    expect(server.registrations).not.toContain("query");
    expect(server.registrations).not.toContain("search_value");
    // But still has the aggregate / catalog tools
    expect(server.registrations).toContain("sample_table");
    expect(server.registrations).toContain("count_rows");
    expect(server.registrations).toContain("time_series");
  });

  it("metadata_only registers only the catalog discovery tools", () => {
    const server = makeSpyServer();
    registerAllTools(server, ctx("metadata_only"));
    const expected = listToolsForRole("metadata_only").sort();
    expect(server.registrations.sort()).toEqual(expected);
    // No data-reading tools
    expect(server.registrations).not.toContain("query");
    expect(server.registrations).not.toContain("sample_table");
    expect(server.registrations).not.toContain("count_rows");
    expect(server.registrations).not.toContain("column_stats");
  });

  it("each tier strictly contains the tier below it", () => {
    const counts = {};
    for (const role of VALID_ROLES) {
      const server = makeSpyServer();
      registerAllTools(server, ctx(role));
      counts[role] = server.registrations.length;
    }
    expect(counts.metadata_only).toBeLessThan(counts.reader_restricted);
    expect(counts.reader_restricted).toBeLessThan(counts.reader);
    expect(counts.reader).toBeLessThanOrEqual(counts.admin);
  });

  it("unknown role registers zero tools (fails closed)", () => {
    const server = makeSpyServer();
    registerAllTools(server, ctx("not_a_real_role"));
    expect(server.registrations).toEqual([]);
  });
});
