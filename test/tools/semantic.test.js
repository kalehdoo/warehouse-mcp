import { describe, it, expect } from "vitest";
import {
  glossaryLookupTool,
  schemaLookupTool,
  tableLookupTool,
} from "../../src/tools/semantic.js";

function makeIndex() {
  const glossary = new Map([
    [
      "revenue",
      {
        name: "revenue",
        definition: "Sum of paid order amounts in USD, excluding refunds.",
        sql_definition: "SUM(o.amount_usd) FILTER (WHERE o.status = 'paid')",
        related_terms: ["active_customer"],
      },
    ],
  ]);
  const schemaDocs = new Map([
    [
      "finance",
      {
        name: "finance",
        description: "Marts powering the finance dashboards.",
        owner: "finance-eng",
        purpose: "mart",
        refresh: "hourly",
        sensitivity: "high",
        glossary_terms: ["revenue"],
      },
    ],
  ]);
  const orders = {
    name: "orders",
    description: "One row per paid order.",
    meta: { schema: "finance", owner: "data-eng", refresh: "hourly", purpose: "mart" },
    columns: [{ name: "id", description: "Primary key" }],
  };
  const tables = new Map([["finance.orders", orders]]);
  const schemas = new Map([["finance", [orders]]]);
  return { glossary, schemaDocs, tables, schemas };
}

const emptyIndex = { glossary: new Map(), schemaDocs: new Map(), tables: new Map(), schemas: new Map() };
const ctx = { tenantId: "default", role: "semantic_only", principal: "test" };

describe("glossary_lookup tool", () => {
  it("with no term, returns brief list of all terms", async () => {
    const r = await glossaryLookupTool.handler({}, ctx, { semantic: makeIndex() });
    expect(r.terms).toEqual([{ name: "revenue", definition: expect.stringContaining("paid") }]);
  });

  it("with a known term, returns the full entry", async () => {
    const r = await glossaryLookupTool.handler({ term: "revenue" }, ctx, { semantic: makeIndex() });
    expect(r.name).toBe("revenue");
    expect(r.sql_definition).toMatch(/SUM/);
  });

  it("with an unknown term, returns not_found with available_terms", async () => {
    const r = await glossaryLookupTool.handler({ term: "mrr" }, ctx, { semantic: makeIndex() });
    expect(r.error).toBe("not_found");
    expect(r.available_terms).toEqual(["revenue"]);
  });

  it("returns a clear note when the semantic layer is empty", async () => {
    const r = await glossaryLookupTool.handler({ term: "anything" }, ctx, { semantic: emptyIndex });
    expect(r.note).toMatch(/not loaded or empty/i);
  });
});

describe("schema_lookup tool", () => {
  it("with no schema, returns a summary of every documented schema", async () => {
    const r = await schemaLookupTool.handler({}, ctx, { semantic: makeIndex() });
    expect(r.schemas).toEqual([
      expect.objectContaining({ name: "finance", purpose: "mart", table_count: 1 }),
    ]);
  });

  it("with a known schema, returns the doc plus its tables", async () => {
    const r = await schemaLookupTool.handler({ schema: "finance" }, ctx, { semantic: makeIndex() });
    expect(r.schema).toBe("finance");
    expect(r.owner).toBe("finance-eng");
    expect(r.tables).toEqual([
      expect.objectContaining({ name: "orders", purpose: "mart" }),
    ]);
  });

  it("with an unknown schema, returns not_found with available_schemas", async () => {
    const r = await schemaLookupTool.handler({ schema: "ghost" }, ctx, { semantic: makeIndex() });
    expect(r.error).toBe("not_found");
    expect(r.available_schemas).toContain("finance");
  });
});

describe("table_lookup tool", () => {
  it("returns the full table doc when the (schema, table) is documented", async () => {
    const r = await tableLookupTool.handler(
      { schema: "finance", table: "orders" },
      ctx,
      { semantic: makeIndex() },
    );
    expect(r.name).toBe("orders");
    expect(r.meta.schema).toBe("finance");
    expect(r.columns.length).toBe(1);
  });

  it("with an unknown table, returns not_found and a helpful hint", async () => {
    const r = await tableLookupTool.handler(
      { schema: "finance", table: "ghost" },
      ctx,
      { semantic: makeIndex() },
    );
    expect(r.error).toBe("not_found");
    expect(r.hint).toMatch(/schema_lookup/);
  });
});
