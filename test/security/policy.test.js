import { describe, it, expect } from "vitest";
import {
  isToolAllowed,
  assertToolAllowed,
  listToolsForRole,
  VALID_ROLES,
} from "../../src/security/policy.js";

describe("role policy — four tiers", () => {
  it("exposes the four role names", () => {
    expect(VALID_ROLES).toEqual([
      "metadata_only",
      "reader_restricted",
      "reader",
      "admin",
    ]);
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
