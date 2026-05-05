import { describe, it, expect } from "vitest";
import { applyResultCap } from "../../src/util/resultCap.js";

const sampleColumns = [{ name: "a" }, { name: "b" }];
const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ a: i, b: i * 2 }));

describe("applyResultCap", () => {
  it("passes through when result is empty or non-tabular", () => {
    expect(applyResultCap(null, 100)).toBe(null);
    expect(applyResultCap("hello", 100)).toBe("hello");
    expect(applyResultCap({ schemas: ["a"] }, 100)).toEqual({ schemas: ["a"] });
  });

  it("passes through when under the cap", () => {
    const result = { columns: sampleColumns, rows: makeRows(10) };
    const capped = applyResultCap(result, 1000);
    expect(capped.rows.length).toBe(10);
    expect(capped.truncated).toBeUndefined();
  });

  it("truncates rows when over the cap and tags the response", () => {
    const result = { columns: sampleColumns, rows: makeRows(1000) };
    const capped = applyResultCap(result, 100); // 100 cells / 2 cols = 50 rows
    expect(capped.rows.length).toBe(50);
    expect(capped.truncated).toBe(true);
    expect(capped.original_row_count).toBe(1000);
    expect(capped.cap_cells).toBe(100);
  });

  it("disables when maxCells=0", () => {
    const result = { columns: sampleColumns, rows: makeRows(10_000) };
    const capped = applyResultCap(result, 0);
    expect(capped.rows.length).toBe(10_000);
    expect(capped.truncated).toBeUndefined();
  });

  it("handles results with missing columns array", () => {
    const result = { rows: makeRows(200) };
    const capped = applyResultCap(result, 50); // 50 cells / 1 col = 50 rows
    expect(capped.rows.length).toBe(50);
    expect(capped.truncated).toBe(true);
  });
});
