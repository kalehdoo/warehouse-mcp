import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCli } from "../../src/cli/router.js";

let stdoutSpy, stderrSpy, exitSpy;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
});

describe("CLI router", () => {
  it("prints help on no args", async () => {
    await runCli([]);
    expect(stdoutSpy).toHaveBeenCalled();
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("warehouse-mcp");
    expect(out).toContain("init");
    expect(out).toContain("doctor");
    expect(out).toContain("start");
  });

  it("prints help on `help`", async () => {
    await runCli(["help"]);
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("Usage:");
  });

  it("prints help on --help and -h", async () => {
    await runCli(["--help"]);
    await runCli(["-h"]);
    expect(stdoutSpy).toHaveBeenCalledTimes(2);
  });

  it("exits 1 on an unknown command", async () => {
    await runCli(["banana"]);
    expect(stderrSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
