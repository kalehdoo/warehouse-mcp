import { describe, it, expect } from "vitest";
import { outputPiiMask } from "../../src/guardrails/post/outputPiiMask.js";

const sampleResult = {
  columns: [{ name: "email" }, { name: "phone" }, { name: "ssn" }],
  rows: [
    { email: "ada@example.com", phone: "555-123-4567", ssn: "123-45-6789", id: 1 },
    { email: "alan@example.com", phone: "5551234567", ssn: "987-65-4321", id: 2 },
  ],
};

const ctxWithRole = (role) => ({ tenantId: "t", role, principal: "p", requestId: "r" });

describe("outputPiiMask guardrail", () => {
  it("admin sees data unmasked", async () => {
    const out = await outputPiiMask.evaluate(ctxWithRole("admin"), "query", {}, sampleResult);
    expect(out.result.rows[0].email).toBe("ada@example.com");
    expect(out.event).toBeUndefined();
  });

  it("metadata_only is a no-op (returns rows untouched)", async () => {
    // metadata_only never returns row data anyway, but be safe
    const out = await outputPiiMask.evaluate(ctxWithRole("metadata_only"), "query", {}, sampleResult);
    expect(out.result.rows[0].email).toBe("ada@example.com");
  });

  it("reader gets partial masks: a***@example.com, ***-**-6789", async () => {
    const out = await outputPiiMask.evaluate(ctxWithRole("reader"), "query", {}, sampleResult);
    expect(out.result.rows[0].email).toBe("a***@example.com");
    expect(out.result.rows[0].ssn).toBe("***-**-6789");
    expect(out.result.rows[0].phone).toBe("***-***-4567");
    expect(out.result.rows[0].id).toBe(1); // numeric pass-through
    expect(out.event.action).toBe("transform");
    expect(out.event.details.level).toBe("partial");
  });

  it("reader_restricted gets full redaction markers", async () => {
    const out = await outputPiiMask.evaluate(
      ctxWithRole("reader_restricted"),
      "query",
      {},
      sampleResult,
    );
    expect(out.result.rows[0].email).toBe("[REDACTED:email]");
    expect(out.result.rows[0].ssn).toBe("[REDACTED:ssn]");
    expect(out.result.rows[0].phone).toBe("[REDACTED:phone]");
    expect(out.event.details.level).toBe("full");
  });

  it("emits no event when a payload contains no PII", async () => {
    const result = { columns: [{ name: "id" }], rows: [{ id: 1 }, { id: 2 }] };
    const out = await outputPiiMask.evaluate(ctxWithRole("reader"), "query", {}, result);
    expect(out.event).toBeUndefined();
    expect(out.result.rows).toEqual(result.rows);
  });

  it("works on the `hits` field (search_value tool)", async () => {
    const result = {
      hits: [{ column_name: "email", value: "ada@example.com" }],
    };
    const out = await outputPiiMask.evaluate(ctxWithRole("reader"), "search_value", {}, result);
    expect(out.result.hits[0].value).toBe("a***@example.com");
  });

  it("works on the `values` field (top_values tool)", async () => {
    const result = { values: [{ value: "ada@example.com", count: 5 }] };
    const out = await outputPiiMask.evaluate(ctxWithRole("reader_restricted"), "top_values", {}, result);
    expect(out.result.values[0].value).toBe("[REDACTED:email]");
  });

  it("validates credit-card matches with Luhn (no false positives on random digits)", async () => {
    const result = {
      rows: [
        { col: "4532015112830366" }, // valid Luhn (test card number)
        { col: "1234567890123456" }, // 16 digits but fails Luhn
      ],
    };
    const out = await outputPiiMask.evaluate(ctxWithRole("reader"), "query", {}, result);
    expect(out.result.rows[0].col).toMatch(/\*\*\*\*-/); // masked (valid CC)
    expect(out.result.rows[1].col).toBe("1234567890123456"); // not masked (Luhn fail)
  });
});
