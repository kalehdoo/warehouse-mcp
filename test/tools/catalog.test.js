import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupDemo, teardown } from "./helpers.js";
import {
  listSchemasTool,
  listTablesTool,
  describeTableTool,
} from "../../src/tools/catalog.js";

let env;

beforeEach(async () => {
  env = await setupDemo();
});

afterEach(teardown);

describe("list_schemas tool", () => {
  it("returns the demo schema and no duplicates", async () => {
    const result = await listSchemasTool.handler({}, env.ctx, env.deps);
    expect(result.schemas).toContain("demo");
    expect(new Set(result.schemas).size).toBe(result.schemas.length);
  });
});

describe("list_tables tool", () => {
  it("returns widgets in demo", async () => {
    const result = await listTablesTool.handler({ schema: "demo" }, env.ctx, env.deps);
    expect(result.schema).toBe("demo");
    expect(result.count).toBe(1);
    expect(result.tables[0].name).toBe("widgets");
    expect(result.tables[0].kind).toBe("table");
  });
});

describe("describe_table tool", () => {
  it("returns columns with name/type/nullable", async () => {
    const result = await describeTableTool.handler(
      { schema: "demo", table: "widgets" },
      env.ctx,
      env.deps,
    );
    expect(result.columns.length).toBe(4);
    const names = result.columns.map((c) => c.name).sort();
    expect(names).toEqual(["color", "id", "name", "price"].sort());
    for (const col of result.columns) {
      expect(typeof col.type).toBe("string");
      expect(typeof col.nullable).toBe("boolean");
    }
  });

  it("throws NOT_FOUND for a missing table", async () => {
    await expect(
      describeTableTool.handler(
        { schema: "demo", table: "no_such_table" },
        env.ctx,
        env.deps,
      ),
    ).rejects.toMatchObject({ name: "WarehouseError", code: "NOT_FOUND" });
  });
});
