import { describe, expect, it } from "vitest";
import { runAdapterContract } from "./contract.js";
import { createDuckDbAdapter } from "../../src/adapters/duckdb.js";

runAdapterContract("DuckDB", async () => {
  const adapter = createDuckDbAdapter({ path: ":memory:" });
  return {
    adapter,
    dialect: "duckdb",
    seed: async () => {
      await adapter.query(`CREATE SCHEMA IF NOT EXISTS demo`);
      // CREATE TABLE is a write — bypass the validator by hitting the adapter
      // directly. The adapter is happy to run any SQL; it's the MCP layer above
      // that enforces read-only via sqlValidator.
      await adapter.query(`CREATE TABLE demo.widgets (id INTEGER, name VARCHAR, color VARCHAR)`);
      await adapter.query(
        `INSERT INTO demo.widgets VALUES (1,'a','red'),(2,'b','blue'),(3,'c','red'),(4,'d','blue'),(5,'e','green')`,
      );
      return { schema: "demo", table: "widgets" };
    },
  };
});

describe("DuckDB — catalog scoping", () => {
  it("lists schemas only from the current catalog", async () => {
    const adapter = createDuckDbAdapter({ path: ":memory:" });
    try {
      await adapter.query(`CREATE SCHEMA IF NOT EXISTS demo`);
      await adapter.query(`ATTACH ':memory:' AS analytics`);
      await adapter.query(`CREATE SCHEMA analytics.other`);

      const schemas = await adapter.listSchemas();

      expect(schemas).toContain("demo");
      expect(schemas).not.toContain("other");
    } finally {
      await adapter.close();
    }
  });
});
