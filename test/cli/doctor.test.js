import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorCommand } from "../../src/cli/doctor.js";

let stdoutSpy, exitSpy, tmpDir, prevEnv;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
  tmpDir = mkdtempSync(join(tmpdir(), "wh-doctor-"));
  prevEnv = { ...process.env };
});

afterEach(() => {
  stdoutSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(tmpDir, { recursive: true, force: true });
  process.env = prevEnv;
});

function setEnv(values) {
  // Wipe MCP_/WAREHOUSE_/etc env so each test starts clean.
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith("MCP_") ||
      k.startsWith("WAREHOUSE_") ||
      k.startsWith("PG_") ||
      k.startsWith("DUCKDB_") ||
      k === "TENANT_ID" ||
      k === "AUDIT_DIR"
    ) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, values);
}

describe("doctor command", () => {
  it("exits 0 when DuckDB is configured and reachable", async () => {
    setEnv({
      WAREHOUSE_TYPE: "duckdb",
      DUCKDB_PATH: ":memory:",
      AUDIT_DIR: tmpDir,
    });
    await doctorCommand();
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Node version");
    expect(out).toContain("Warehouse selected");
    expect(out).toContain("Connection + SELECT 1");
    expect(out).toContain("All checks passed");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("exits 1 when WAREHOUSE_TYPE is missing", async () => {
    setEnv({ AUDIT_DIR: tmpDir });
    await doctorCommand();
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Warehouse selected");
    expect(out).toContain("WAREHOUSE_TYPE is unset");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("flags missing required env for the selected warehouse", async () => {
    setEnv({
      WAREHOUSE_TYPE: "postgres",
      AUDIT_DIR: tmpDir,
      // PG_HOST, PG_DATABASE, PG_USER deliberately omitted
    });
    await doctorCommand();
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("postgres env vars");
    expect(out).toContain("missing:");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
