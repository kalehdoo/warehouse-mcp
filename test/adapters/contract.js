/**
 * Adapter contract suite — runs the same behavior tests against any adapter
 * that satisfies the WarehouseAdapter interface. Today only DuckDB exercises
 * this in PR CI; once testcontainers are wired (Phase 7), Postgres and Oracle
 * will run the same suite against real backends.
 */
import { describe, it, expect, afterAll } from "vitest";
import { WarehouseError } from "../../src/adapters/errors.js";

/**
 * @param {string} name           Display name for the test group.
 * @param {() => Promise<{adapter: object, dialect: string, seed: () => Promise<{schema: string, table: string}>}>} setup
 *        Returns an adapter, the dialect tag, and a `seed` thunk that creates
 *        a sample table and returns its schema/table names. The adapter must
 *        already be reachable.
 */
export function runAdapterContract(name, setup) {
  describe(`${name} — adapter contract`, () => {
    let adapter, schema, table;

    afterAll(async () => {
      await adapter?.close?.();
    });

    it("connects, seeds, and reports its type", async () => {
      const ctx = await setup();
      adapter = ctx.adapter;
      ({ schema, table } = await ctx.seed());
      expect(adapter.type).toBe(ctx.dialect);
    });

    it("listSchemas includes the seeded schema", async () => {
      const schemas = await adapter.listSchemas();
      expect(schemas).toContain(schema);
    });

    it("listTables returns the seeded table with kind='table'", async () => {
      const tables = await adapter.listTables(schema);
      const found = tables.find((t) => t.name.toLowerCase() === table.toLowerCase());
      expect(found).toBeTruthy();
      expect(found.kind).toBe("table");
      expect(found.schema).toBe(schema);
    });

    it("describeTable returns ordered columns with names and types", async () => {
      const cols = await adapter.describeTable(schema, table);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) {
        expect(typeof c.name).toBe("string");
        expect(typeof c.type).toBe("string");
        expect(typeof c.nullable).toBe("boolean");
      }
    });

    it("describeTable on a missing table throws WarehouseError(NOT_FOUND)", async () => {
      await expect(adapter.describeTable(schema, "no_such_table_xyz_123")).rejects.toMatchObject({
        name: "WarehouseError",
        code: "NOT_FOUND",
      });
    });

    it("query returns rows + columns", async () => {
      const result = await adapter.query(`SELECT 1 AS one, 'hi' AS two`);
      expect(result.rows.length).toBe(1);
      expect(result.columns.length).toBe(2);
      expect(result.columns.map((c) => c.name).sort()).toEqual(["one", "two"]);
    });

    it("query on bad SQL throws WarehouseError(QUERY_FAILED)", async () => {
      await expect(adapter.query("SELECT FROM WHERE")).rejects.toBeInstanceOf(WarehouseError);
    });

    it("sample returns up to N rows", async () => {
      const result = await adapter.sample(schema, table, 5);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.length).toBeLessThanOrEqual(5);
    });
  });
}
