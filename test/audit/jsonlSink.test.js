import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlAuditSink } from "../../src/audit/jsonlSink.js";

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wh-audit-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ctx = {
  tenantId: "default",
  role: "admin",
  principal: "test",
  requestId: "req_x",
};

describe("JsonlAuditSink", () => {
  it("writes a line per call with all expected fields", () => {
    const sink = new JsonlAuditSink({ dir, rotation: "daily" });
    sink.write({ ctx, tool: "query", sql: "SELECT 1", rowCount: 1, durationMs: 5 });
    sink.close();
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBe(1);
    const line = readFileSync(join(dir, files[0]), "utf8").trim();
    const record = JSON.parse(line);
    expect(record.tenant_id).toBe("default");
    expect(record.tool).toBe("query");
    expect(record.sql).toBe("SELECT 1");
    expect(record.row_count).toBe(1);
    expect(record.duration_ms).toBe(5);
  });

  it("records the session's include_semantic flag", () => {
    const sink = new JsonlAuditSink({ dir, rotation: "off" });
    sink.write({ ctx: { ...ctx, includeSemantic: false }, tool: "query", durationMs: 1 });
    sink.write({ ctx: { ...ctx, includeSemantic: true }, tool: "query", durationMs: 1 });
    sink.close();
    const lines = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]).include_semantic).toBe(false);
    expect(JSON.parse(lines[1]).include_semantic).toBe(true);
  });

  it("clips oversized sql and error fields", () => {
    const sink = new JsonlAuditSink({ dir, rotation: "off", fieldMaxBytes: 100 });
    const big = "x".repeat(10_000);
    sink.write({ ctx, tool: "query", sql: big, error: big, durationMs: 1 });
    sink.close();
    const line = readFileSync(join(dir, "audit.jsonl"), "utf8").trim();
    const record = JSON.parse(line);
    expect(record.sql.length).toBeLessThanOrEqual(120); // 100 + clipped marker
    expect(record.sql).toMatch(/\[clipped\]$/);
    expect(record.error).toMatch(/\[clipped\]$/);
  });

  it("never throws even if write fails", () => {
    const sink = new JsonlAuditSink({ dir: "/dev/null/does/not/exist", rotation: "off" });
    expect(() => sink.write({ ctx, tool: "query" })).not.toThrow();
  });
});
