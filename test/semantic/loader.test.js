import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSemanticDir, emptyIndex, summarize } from "../../src/semantic/loader.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wh-semantic-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(rel, contents) {
  const path = join(dir, rel);
  const parent = path.split("/").slice(0, -1).join("/");
  mkdirSync(parent, { recursive: true });
  writeFileSync(path, contents);
}

const validGlossary = `
version: 1
terms:
  - name: revenue
    definition: Sum of paid invoice amounts.
    sql_definition: SELECT SUM(amount_cents) FROM finance.invoices WHERE status = 'paid'
    related_terms: [invoice]
    tags: [finance, metric]
`;

const validFinanceModels = `
version: 2
models:
  - name: invoices
    description: One row per invoice.
    meta:
      schema: finance
      owner: finance-team
      sensitivity: medium
    columns:
      - name: id
        description: Primary key.
      - name: amount_cents
        description: Net amount in cents.
        meta:
          sensitivity: medium
          unit: USD_cents
`;

describe("loader — happy path", () => {
  it("loads glossary + models into a coherent index", () => {
    write("glossary.yml", validGlossary);
    write("finance.yml", validFinanceModels);
    const index = loadSemanticDir(dir);
    expect(index.glossary.size).toBe(1);
    expect(index.glossary.get("revenue").definition).toContain("paid invoice");
    expect(index.tables.size).toBe(1);
    expect(index.tables.get("finance.invoices").columns.length).toBe(2);
    expect(index.schemas.get("finance").length).toBe(1);
  });

  it("walks subdirectories", () => {
    write("glossary.yml", validGlossary);
    write("models/staging/finance/schema.yml", validFinanceModels);
    const index = loadSemanticDir(dir);
    expect(index.tables.size).toBe(1);
    expect(index.tables.has("finance.invoices")).toBe(true);
  });

  it("merges multiple model files", () => {
    write(
      "finance.yml",
      validFinanceModels.replace("invoices", "invoices_a"),
    );
    write(
      "hr.yml",
      `
version: 2
models:
  - name: employees
    description: One row per employee.
    meta: { schema: hr }
    columns:
      - name: id
        description: PK
`,
    );
    const index = loadSemanticDir(dir);
    expect(index.schemas.size).toBe(2);
    expect(index.tables.size).toBe(2);
  });

  it("accepts empty files (no-op)", () => {
    write("glossary.yml", "");
    write("nothing.yml", "# just a comment\n");
    const index = loadSemanticDir(dir);
    expect(index.glossary.size).toBe(0);
    expect(index.tables.size).toBe(0);
  });

  it("summarize() produces a stable string", () => {
    write("glossary.yml", validGlossary);
    write("finance.yml", validFinanceModels);
    const index = loadSemanticDir(dir);
    expect(summarize(index)).toMatch(/1 glossary terms?, 1 tables across 1 schemas?/);
  });
});

describe("loader — collisions", () => {
  it("errors when two glossary files define the same term", () => {
    write("glossary.yml", validGlossary);
    write("nested/glossary.yml", validGlossary);
    expect(() => loadSemanticDir(dir)).toThrow(/Glossary term 'revenue' defined in both/);
  });

  it("errors when two model files define the same (schema, table)", () => {
    write("finance.yml", validFinanceModels);
    write("finance-dupe.yml", validFinanceModels);
    expect(() => loadSemanticDir(dir)).toThrow(/Table 'finance.invoices' defined in both/);
  });
});

describe("loader — schema validation", () => {
  it("rejects glossary file missing 'version'", () => {
    write(
      "glossary.yml",
      `terms:
  - name: revenue
    definition: foo
`,
    );
    expect(() => loadSemanticDir(dir)).toThrow(/Schema validation failed/);
  });

  it("rejects model with no meta.schema field", () => {
    write(
      "finance.yml",
      `
version: 2
models:
  - name: invoices
    description: foo
    meta: { owner: someone }
    columns: []
`,
    );
    expect(() => loadSemanticDir(dir)).toThrow(/Schema validation failed/);
  });

  it("rejects unknown sensitivity value", () => {
    write(
      "finance.yml",
      `
version: 2
models:
  - name: invoices
    description: foo
    meta:
      schema: finance
      sensitivity: super_top_secret
    columns: []
`,
    );
    expect(() => loadSemanticDir(dir)).toThrow(/Schema validation failed/);
  });

  it("rejects invalid YAML syntax", () => {
    write("finance.yml", "version: 2\nmodels:\n  - name: [unclosed bracket");
    expect(() => loadSemanticDir(dir)).toThrow(/Invalid YAML/);
  });
});

describe("emptyIndex", () => {
  it("returns valid empty index for missing-dir cases", () => {
    const idx = emptyIndex();
    expect(idx.glossary.size).toBe(0);
    expect(idx.tables.size).toBe(0);
    expect(idx.schemas.size).toBe(0);
  });
});
