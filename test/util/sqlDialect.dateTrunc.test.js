import { describe, it, expect } from "vitest";
import { dateTrunc, TIME_PERIODS } from "../../src/util/sqlDialect.js";

describe("dateTrunc", () => {
  it("uses DATE_TRUNC for postgres / redshift / snowflake / duckdb", () => {
    for (const d of ["postgres", "redshift", "snowflake", "duckdb"]) {
      expect(dateTrunc("day", '"created_at"', d)).toBe(`DATE_TRUNC('day', "created_at")`);
    }
  });

  it("uses TIMESTAMP_TRUNC for bigquery", () => {
    expect(dateTrunc("month", "`created_at`", "bigquery")).toBe(
      "TIMESTAMP_TRUNC(`created_at`, MONTH)",
    );
  });

  it("uses TRUNC with format codes for oracle", () => {
    expect(dateTrunc("day", '"CREATED_AT"', "oracle")).toBe(`TRUNC("CREATED_AT", 'DD')`);
    expect(dateTrunc("month", '"CREATED_AT"', "oracle")).toBe(`TRUNC("CREATED_AT", 'MM')`);
    expect(dateTrunc("year", '"CREATED_AT"', "oracle")).toBe(`TRUNC("CREATED_AT", 'YYYY')`);
  });

  it("rejects unknown periods", () => {
    expect(() => dateTrunc("decade", '"x"', "postgres")).toThrow(/Unsupported time period/);
  });

  it("exposes the allowed periods", () => {
    expect(TIME_PERIODS).toEqual(["hour", "day", "week", "month", "quarter", "year"]);
  });
});
