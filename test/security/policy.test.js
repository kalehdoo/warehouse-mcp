import { describe, it, expect } from "vitest";
import {
  isToolAllowed,
  assertToolAllowed,
  listToolsForRole,
  VALID_ROLES,
} from "../../src/security/policy.js";

describe("role policy — five tiers", () => {
  it("exposes the five role names", () => {
    expect(VALID_ROLES).toEqual([
      "semantic_only",
      "metadata_only",
      "reader_restricted",
      "reader",
      "admin",
    ]);
  });

  it("semantic_only allows only the in-memory semantic-lookup tools", () => {
    expect(listToolsForRole("semantic_only").sort()).toEqual([
      "glossary_lookup",
      "schema_lookup",
      "table_lookup",
    ]);
    for (const t of ["glossary_lookup", "schema_lookup", "table_lookup"]) {
      expect(isToolAllowed("semantic_only", t)).toBe(true);
    }
    for (const t of [
      "list_schemas",
      "list_tables",
      "describe_table",
      "query",
      "sample_table",
      "search_value",
    ]) {
      expect(isToolAllowed("semantic_only", t)).toBe(false);
    }
  });

  it("semantic_only is recognized (not lumped with unknown roles)", () => {
    // Guards against a regression where a typo or missing entry in ROLE_TOOLS
    // would silently turn semantic_only into an unknown-role-style deny.
    expect(VALID_ROLES.includes("semantic_only")).toBe(true);
    expect(() => assertToolAllowed({ role: "semantic_only" }, "list_schemas")).toThrow(
      /not permitted/,
    );
  });

  it("higher tiers inherit the semantic-lookup tools as cheap free reads", () => {
    for (const role of ["metadata_only", "reader_restricted", "reader", "admin"]) {
      expect(isToolAllowed(role, "glossary_lookup")).toBe(true);
      expect(isToolAllowed(role, "schema_lookup")).toBe(true);
      expect(isToolAllowed(role, "table_lookup")).toBe(true);
    }
  });

  it("metadata_only allows catalog tools only — no row data", () => {
    for (const t of [
      "list_schemas",
      "list_tables",
      "describe_table",
      "find_columns",
      "get_foreign_keys",
      "get_view_definition",
    ]) {
      expect(isToolAllowed("metadata_only", t)).toBe(true);
    }
    for (const t of ["query", "sample_table", "count_rows", "search_value", "time_series"]) {
      expect(isToolAllowed("metadata_only", t)).toBe(false);
    }
  });

  it("reader_restricted adds aggregates and samples — but not arbitrary SELECT", () => {
    expect(isToolAllowed("reader_restricted", "sample_table")).toBe(true);
    expect(isToolAllowed("reader_restricted", "count_rows")).toBe(true);
    expect(isToolAllowed("reader_restricted", "column_stats")).toBe(true);
    expect(isToolAllowed("reader_restricted", "top_values")).toBe(true);
    expect(isToolAllowed("reader_restricted", "time_series")).toBe(true);
    // still no raw SELECT, no literal search
    expect(isToolAllowed("reader_restricted", "query")).toBe(false);
    expect(isToolAllowed("reader_restricted", "search_value")).toBe(false);
  });

  it("reader allows arbitrary SELECT and literal search", () => {
    expect(isToolAllowed("reader", "query")).toBe(true);
    expect(isToolAllowed("reader", "search_value")).toBe(true);
    // and everything below
    expect(isToolAllowed("reader", "sample_table")).toBe(true);
    expect(isToolAllowed("reader", "list_schemas")).toBe(true);
  });

  it("admin sees everything reader sees plus future write tools", () => {
    expect(listToolsForRole("admin").length).toBeGreaterThanOrEqual(
      listToolsForRole("reader").length,
    );
  });

  it("rejects unknown roles", () => {
    expect(isToolAllowed("not_a_role", "query")).toBe(false);
  });

  it("assertToolAllowed throws for disallowed combinations", () => {
    expect(() => assertToolAllowed({ role: "metadata_only" }, "query")).toThrow(/not permitted/);
    expect(() => assertToolAllowed({ role: "reader_restricted" }, "search_value")).toThrow();
    expect(() => assertToolAllowed({ role: "reader" }, "query")).not.toThrow();
  });
});
