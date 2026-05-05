import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import {
  sampleTableTool,
  columnStatsTool,
  topValuesTool,
} from "../../src/tools/profile.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
});

afterEach(teardown);

describe("sample_table tool", () => {
  it("returns up to N rows", async () => {
    const result = await sampleTableTool.handler(
      { schema: "demo", table: "widgets", n: 3 },
      env.ctx,
      env.deps,
    );
    expect(result.rows.length).toBeLessThanOrEqual(3);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});

describe("column_stats tool", () => {
  it("computes stats including AVG for a numeric column", async () => {
    const result = await columnStatsTool.handler(
      { schema: "demo", table: "widgets", column: "price" },
      env.ctx,
      env.deps,
    );
    expect(result.column).toBe("price");
    expect(Number(result.stats.row_count)).toBe(5);
    expect(Number(result.stats.distinct_count)).toBe(5);
    expect(Number(result.stats.null_count)).toBe(0);
    expect(Number(result.stats.min_value)).toBe(1.5);
    expect(Number(result.stats.max_value)).toBe(5.5);
    expect(Number(result.stats.avg_value)).toBeCloseTo(3.5, 5);
  });

  it("omits AVG for a non-numeric column", async () => {
    const result = await columnStatsTool.handler(
      { schema: "demo", table: "widgets", column: "color" },
      env.ctx,
      env.deps,
    );
    expect(Number(result.stats.distinct_count)).toBe(3);
    expect(result.stats.avg_value).toBeNull();
  });

  it("throws NOT_FOUND for a missing column", async () => {
    await expect(
      columnStatsTool.handler(
        { schema: "demo", table: "widgets", column: "no_col" },
        env.ctx,
        env.deps,
      ),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "NOT_FOUND" });
  });
});

describe("top_values tool", () => {
  it("returns the most frequent values in descending order", async () => {
    const result = await topValuesTool.handler(
      { schema: "demo", table: "widgets", column: "color", k: 2 },
      env.ctx,
      env.deps,
    );
    expect(result.values.length).toBe(2);
    expect(["red", "blue"]).toContain(result.values[0].value);
    expect(Number(result.values[0].count)).toBe(2);
  });
});
