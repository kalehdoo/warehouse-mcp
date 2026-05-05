import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import { queryTool } from "../../src/tools/query.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
});

afterEach(teardown);

describe("query tool", () => {
  it("returns rows + columns for a SELECT", async () => {
    const result = await queryTool.handler({ sql: "SELECT * FROM demo.widgets" }, env.ctx, env.deps);
    expect(result.rows.length).toBe(5);
    expect(result.columns.map((c) => c.name).sort()).toEqual(
      ["color", "id", "name", "price"].sort(),
    );
  });

  it("auto-applies the configured default limit", async () => {
    // Insert lots so we can prove the cap is honored
    const adapter = env.adapter;
    for (let i = 6; i <= 50; i++) {
      await adapter.query(
        `INSERT INTO demo.widgets VALUES (${i},'x','red',${i})`,
      );
    }
    const result = await queryTool.handler(
      { sql: "SELECT * FROM demo.widgets", max_rows: 10 },
      env.ctx,
      env.deps,
    );
    expect(result.rows.length).toBe(10);
  });

  it("rejects writes (validator boundary)", async () => {
    await expect(
      queryTool.handler({ sql: "DROP TABLE demo.widgets" }, env.ctx, env.deps),
    ).rejects.toThrow();
  });

  it("rejects multiple statements", async () => {
    await expect(
      queryTool.handler({ sql: "SELECT 1; SELECT 2" }, env.ctx, env.deps),
    ).rejects.toThrow();
  });
});
