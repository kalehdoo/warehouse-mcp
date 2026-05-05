import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import { searchValueTool } from "../../src/tools/search.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
});

afterEach(teardown);

describe("search_value tool", () => {
  it("finds an exact-match literal across text columns", async () => {
    const result = await searchValueTool.handler(
      { schema: "demo", table: "widgets", value: "red" },
      env.ctx,
      env.deps,
    );
    expect(result.columns_scanned).toContain("color");
    expect(result.hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of result.hits) {
      expect(hit.value).toBe("red");
      expect(hit.column_name).toBe("color");
    }
  });

  it("returns zero hits for an absent value (no error)", async () => {
    const result = await searchValueTool.handler(
      { schema: "demo", table: "widgets", value: "nonexistent_xyz" },
      env.ctx,
      env.deps,
    );
    expect(result.hits.length).toBe(0);
  });

  it("escapes single quotes safely", async () => {
    // Insert a row with a single quote in a text field
    await env.adapter.query(
      `INSERT INTO demo.widgets VALUES (99, 'name with '' quote', 'red', 9.9)`,
    );
    const result = await searchValueTool.handler(
      { schema: "demo", table: "widgets", value: "name with ' quote" },
      env.ctx,
      env.deps,
    );
    expect(result.hits.length).toBeGreaterThanOrEqual(1);
    expect(result.hits.find((h) => h.value === "name with ' quote")).toBeTruthy();
  });
});
