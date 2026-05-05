import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/util/config.js";

let prev;

beforeEach(() => {
  prev = { ...process.env };
});

afterEach(() => {
  process.env = prev;
});

describe("DuckDB config — MotherDuck token threading", () => {
  it("surfaces MOTHERDUCK_TOKEN as motherduckToken on the warehouse config", () => {
    process.env.WAREHOUSE_TYPE = "duckdb";
    process.env.DUCKDB_PATH = "md:sample_data";
    process.env.MOTHERDUCK_TOKEN = "test_token_abc";
    const cfg = loadConfig();
    expect(cfg.warehouse.type).toBe("duckdb");
    expect(cfg.warehouse.path).toBe("md:sample_data");
    expect(cfg.warehouse.motherduckToken).toBe("test_token_abc");
  });

  it("leaves motherduckToken undefined when MOTHERDUCK_TOKEN is unset", () => {
    process.env.WAREHOUSE_TYPE = "duckdb";
    process.env.DUCKDB_PATH = ":memory:";
    delete process.env.MOTHERDUCK_TOKEN;
    const cfg = loadConfig();
    expect(cfg.warehouse.motherduckToken).toBeUndefined();
  });
});
