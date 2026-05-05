import { describe, it, expect } from "vitest";
import { GuardrailPipeline } from "../../src/guardrails/pipeline.js";

const ctx = { tenantId: "t", role: "reader", principal: "p", requestId: "r" };

describe("GuardrailPipeline.runPre", () => {
  it("returns allow when no pre-guardrails are registered", async () => {
    const p = new GuardrailPipeline();
    const out = await p.runPre(ctx, "query", {});
    expect(out.result.action).toBe("allow");
    expect(out.events).toEqual([]);
  });

  it("runs pre-guardrails in order and accumulates events", async () => {
    const calls = [];
    const g1 = {
      name: "g1",
      kind: "pre",
      async evaluate() {
        calls.push("g1");
        return { action: "allow", event: { guardrail: "g1", action: "allow" } };
      },
    };
    const g2 = {
      name: "g2",
      kind: "pre",
      async evaluate() {
        calls.push("g2");
        return { action: "allow", event: { guardrail: "g2", action: "allow" } };
      },
    };
    const p = new GuardrailPipeline({ pre: [g1, g2] });
    const out = await p.runPre(ctx, "query", {});
    expect(calls).toEqual(["g1", "g2"]);
    expect(out.events.length).toBe(2);
    expect(out.result.action).toBe("allow");
  });

  it("short-circuits on the first deny", async () => {
    const calls = [];
    const g1 = { name: "g1", kind: "pre", async evaluate() { calls.push("g1"); return { action: "allow" }; } };
    const g2 = { name: "g2", kind: "pre", async evaluate() {
      calls.push("g2");
      return { action: "deny", reason: "policy", event: { guardrail: "g2", action: "deny", reason: "policy" } };
    } };
    const g3 = { name: "g3", kind: "pre", async evaluate() { calls.push("g3"); return { action: "allow" }; } };
    const p = new GuardrailPipeline({ pre: [g1, g2, g3] });
    const out = await p.runPre(ctx, "query", {});
    expect(calls).toEqual(["g1", "g2"]); // g3 never runs
    expect(out.result.action).toBe("deny");
    expect(out.result.reason).toBe("policy");
  });

  it("propagates approve_required", async () => {
    const g = { name: "g", kind: "pre", async evaluate() {
      return { action: "approve_required", reason: "big query" };
    } };
    const out = await new GuardrailPipeline({ pre: [g] }).runPre(ctx, "query", {});
    expect(out.result.action).toBe("approve_required");
    expect(out.result.reason).toBe("big query");
  });

  it("fails closed when a pre-guardrail throws", async () => {
    const g = { name: "buggy", kind: "pre", async evaluate() { throw new Error("boom"); } };
    const out = await new GuardrailPipeline({ pre: [g] }).runPre(ctx, "query", {});
    expect(out.result.action).toBe("deny");
    expect(out.result.reason).toMatch(/buggy.*errored/);
    expect(out.events[0].guardrail).toBe("buggy");
  });
});

describe("GuardrailPipeline.runPost", () => {
  it("passes the result through unchanged when no post-guardrails registered", async () => {
    const r = { rows: [{ a: 1 }] };
    const out = await new GuardrailPipeline().runPost(ctx, "query", {}, r);
    expect(out.result).toBe(r);
    expect(out.events).toEqual([]);
  });

  it("chains transforms in order", async () => {
    const g1 = { name: "g1", kind: "post", async evaluate(_c, _t, _a, r) {
      return { result: { ...r, marked_by: ["g1"] } };
    } };
    const g2 = { name: "g2", kind: "post", async evaluate(_c, _t, _a, r) {
      return { result: { ...r, marked_by: [...(r.marked_by || []), "g2"] } };
    } };
    const out = await new GuardrailPipeline({ post: [g1, g2] }).runPost(ctx, "query", {}, { x: 1 });
    expect(out.result.marked_by).toEqual(["g1", "g2"]);
  });

  it("logs an event but keeps going when a post-guardrail throws", async () => {
    const g_bad = { name: "bad", kind: "post", async evaluate() { throw new Error("oops"); } };
    const g_good = { name: "good", kind: "post", async evaluate(_c, _t, _a, r) {
      return { result: { ...r, marked: true } };
    } };
    const out = await new GuardrailPipeline({ post: [g_bad, g_good] }).runPost(ctx, "query", {}, { x: 1 });
    expect(out.result.marked).toBe(true); // good guardrail still ran
    expect(out.events.find((e) => e.guardrail === "bad")).toBeTruthy();
  });
});
