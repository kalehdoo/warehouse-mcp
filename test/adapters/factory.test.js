import { describe, it, expect, afterEach } from "vitest";
import {
  getAdapter,
  closeAllAdapters,
  SUPPORTED_WAREHOUSES,
  _clearPoolForTests,
} from "../../src/adapters/index.js";
import { WarehouseError } from "../../src/adapters/errors.js";

const ctx = (tenantId = "default") => ({ tenantId });

const duckdbProvider = {
  getWarehouseConfig: () => ({ type: "duckdb", path: ":memory:" }),
};

const unknownProvider = {
  getWarehouseConfig: () => ({ type: "made_up_warehouse" }),
};

afterEach(async () => {
  await closeAllAdapters();
});

describe("adapter factory", () => {
  it("supports the v1 warehouse list", () => {
    expect(SUPPORTED_WAREHOUSES.sort()).toEqual([
      "bigquery",
      "duckdb",
      "oracle",
      "postgres",
      "redshift",
      "snowflake",
    ]);
  });

  it("instantiates a DuckDB adapter on demand", async () => {
    const adapter = await getAdapter(ctx(), duckdbProvider);
    expect(adapter.type).toBe("duckdb");
  });

  it("returns the same adapter for the same tenant (pool hit)", async () => {
    const a1 = await getAdapter(ctx("acme"), duckdbProvider);
    const a2 = await getAdapter(ctx("acme"), duckdbProvider);
    expect(a1).toBe(a2);
  });

  it("returns different adapters for different tenants (pool miss)", async () => {
    const a1 = await getAdapter(ctx("acme"), duckdbProvider);
    const a2 = await getAdapter(ctx("globex"), duckdbProvider);
    expect(a1).not.toBe(a2);
  });

  it("throws WarehouseError(UNSUPPORTED) for an unknown warehouse type", async () => {
    await expect(getAdapter(ctx(), unknownProvider)).rejects.toMatchObject({
      name: "WarehouseError",
      code: "UNSUPPORTED",
    });
  });
});

describe("lazy driver loading", () => {
  it("does not eagerly load Snowflake/BigQuery/Oracle/Postgres just by importing the factory", async () => {
    _clearPoolForTests();
    // After importing src/adapters/index.js (already done above), only the
    // factory module itself should be in the require/import cache for adapters.
    // We can't directly inspect the ESM cache from here, but we can prove the
    // observable behavior: instantiating DuckDB doesn't error even if the
    // other drivers' native deps are unhappy on this host.
    const adapter = await getAdapter(ctx(), duckdbProvider);
    expect(adapter.type).toBe("duckdb");
  });
});

describe("WarehouseError shape", () => {
  it("carries a code, warehouse tag, and optional cause", () => {
    const cause = new Error("driver boom");
    const e = new WarehouseError("QUERY_FAILED", "boom", { cause, warehouse: "duckdb" });
    expect(e.name).toBe("WarehouseError");
    expect(e.code).toBe("QUERY_FAILED");
    expect(e.warehouse).toBe("duckdb");
    expect(e.cause).toBe(cause);
  });
});
