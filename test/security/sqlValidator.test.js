import { describe, it, expect } from "vitest";
import { normalizeReadOnlySql, assertReadOnly, stripSqlComments } from "../../src/security/sqlValidator.js";

describe("stripSqlComments", () => {
  it("removes block comments", () => {
    expect(stripSqlComments("SELECT 1 /* hi */ FROM t")).toMatch(/SELECT 1\s+FROM t/);
  });
  it("removes line comments", () => {
    expect(stripSqlComments("SELECT 1 -- hi\nFROM t")).toMatch(/SELECT 1\s*\n?\s*FROM t/);
  });
});

describe("normalizeReadOnlySql — common rules", () => {
  it("requires a dialect", () => {
    expect(() => normalizeReadOnlySql("SELECT 1")).toThrow(/dialect/);
  });

  it("rejects multiple statements", () => {
    expect(() => normalizeReadOnlySql("SELECT 1; SELECT 2", { dialect: "postgres" })).toThrow(/single SQL statement/);
  });

  it("rejects writes", () => {
    expect(() => normalizeReadOnlySql("INSERT INTO t VALUES (1)", { dialect: "postgres" })).toThrow(/read-only/);
    expect(() => normalizeReadOnlySql("DELETE FROM t", { dialect: "postgres" })).toThrow();
    expect(() => normalizeReadOnlySql("DROP TABLE t", { dialect: "postgres" })).toThrow();
    expect(() => normalizeReadOnlySql("UPDATE t SET x=1", { dialect: "postgres" })).toThrow();
  });

  it("rejects writes hidden inside SELECT", () => {
    expect(() =>
      normalizeReadOnlySql("SELECT 1 FROM t; DROP TABLE u", { dialect: "postgres" }),
    ).toThrow();
  });

  it("rejects recursive CTEs", () => {
    expect(() =>
      normalizeReadOnlySql("WITH RECURSIVE r AS (SELECT 1) SELECT * FROM r", { dialect: "postgres" }),
    ).toThrow(/Recursive/);
  });

  it("rejects too many UNIONs", () => {
    const sql = "SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4";
    expect(() => normalizeReadOnlySql(sql, { dialect: "postgres", maxUnions: 2 })).toThrow(/UNION/);
  });

  it("allows SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA prefixes", () => {
    for (const prefix of ["SELECT 1", "WITH a AS (SELECT 1) SELECT * FROM a", "SHOW TABLES", "DESCRIBE t", "EXPLAIN SELECT 1", "PRAGMA table_info('t')"]) {
      expect(() => normalizeReadOnlySql(prefix, { dialect: "duckdb" })).not.toThrow();
    }
  });
});

describe("normalizeReadOnlySql — dialect: postgres / duckdb / others", () => {
  it("auto-applies a LIMIT when none present", () => {
    const out = normalizeReadOnlySql("SELECT * FROM t", { dialect: "postgres", defaultLimit: 50 });
    expect(out).toMatch(/LIMIT 50/);
    expect(out).not.toMatch(/FETCH FIRST/);
  });

  it("preserves user-supplied LIMIT under the cap", () => {
    const out = normalizeReadOnlySql("SELECT * FROM t LIMIT 5", { dialect: "postgres", maxLimit: 100 });
    expect(out).toBe("SELECT * FROM t LIMIT 5");
  });

  it("rejects user-supplied LIMIT over the cap", () => {
    expect(() =>
      normalizeReadOnlySql("SELECT * FROM t LIMIT 99999", { dialect: "postgres", maxLimit: 100 }),
    ).toThrow(/maximum/);
  });
});

describe("normalizeReadOnlySql — dialect: oracle", () => {
  it("auto-applies FETCH FIRST instead of LIMIT", () => {
    const out = normalizeReadOnlySql("SELECT * FROM t", { dialect: "oracle", defaultLimit: 25 });
    expect(out).toMatch(/FETCH FIRST 25 ROWS ONLY/);
    expect(out).not.toMatch(/LIMIT/);
  });

  it("preserves user-supplied FETCH FIRST under the cap", () => {
    const out = normalizeReadOnlySql("SELECT * FROM t FETCH FIRST 10 ROWS ONLY", {
      dialect: "oracle",
      maxLimit: 100,
    });
    expect(out).toMatch(/FETCH FIRST 10 ROWS ONLY/);
  });

  it("rejects raw LIMIT keyword on Oracle (with helpful error)", () => {
    expect(() =>
      normalizeReadOnlySql("SELECT * FROM t LIMIT 5", { dialect: "oracle" }),
    ).toThrow(/Oracle does not support LIMIT/);
  });
});

describe("assertReadOnly — adapter-boundary defensive check", () => {
  it("passes SELECT", () => {
    expect(() => assertReadOnly("SELECT 1")).not.toThrow();
  });
  it("blocks writes", () => {
    expect(() => assertReadOnly("DROP TABLE t")).toThrow();
    expect(() => assertReadOnly("UPDATE t SET x=1")).toThrow();
  });
});
