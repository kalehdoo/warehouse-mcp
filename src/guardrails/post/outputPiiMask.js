/**
 * Output PII masking — role-aware redaction of result rows.
 *
 * Rules per MCP role:
 *   metadata_only      → no rows ever returned, so this guardrail is a no-op
 *   reader_restricted  → full mask (e.g. emails become [REDACTED:email])
 *   reader             → partial mask (e.g. a***@example.com, ***-**-1234)
 *   admin              → unmasked
 *
 * The guardrail walks every string field in result.rows (or result.hits /
 * result.values for tools whose result shape uses different field names) and
 * applies the per-role mask. Numeric / boolean / null fields pass through.
 *
 * Default OFF. Enable with GUARDRAIL_PII_MASK=on.
 *
 * Patterns are intentionally conservative — we'd rather miss a borderline
 * case than false-positive on a column name like "user_id" that happens to
 * match a credit-card-shaped digit string. False positives in masking erode
 * agent trust faster than the occasional miss.
 */

const PATTERNS = [
  {
    name: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    partial: (m) => `${m[0]}***@${m.split("@")[1]}`,
    full: () => "[REDACTED:email]",
  },
  {
    name: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    partial: (m) => `***-**-${m.slice(-4)}`,
    full: () => "[REDACTED:ssn]",
  },
  {
    name: "credit_card",
    // 13–19 digit runs with optional spaces/hyphens — Luhn-validated below
    re: /\b(?:\d[ -]?){13,19}\b/g,
    partial: (m) => `****-****-****-${m.replace(/[ -]/g, "").slice(-4)}`,
    full: () => "[REDACTED:credit_card]",
    luhn: true,
  },
  {
    name: "phone_us",
    // +1 555 123 4567 / 555-123-4567 / (555) 123-4567
    // Requires at least one literal separator between groups so we don't
    // false-positive on raw 10-digit IDs like "1234567890".
    re: /(?:\+?1[-. ])?(?:\(\d{3}\)\s*|\d{3}[-. ])\d{3}[-. ]\d{4}\b/g,
    partial: (m) => `***-***-${m.replace(/\D/g, "").slice(-4)}`,
    full: () => "[REDACTED:phone]",
  },
  {
    name: "ipv4",
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    partial: (m) => {
      const parts = m.split(".");
      return `${parts[0]}.${parts[1]}.*.*`;
    },
    full: () => "[REDACTED:ipv4]",
  },
];

function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function maskString(input, level) {
  if (typeof input !== "string" || input.length < 4) return { value: input, hits: [] };
  let out = input;
  const hits = [];
  for (const p of PATTERNS) {
    out = out.replace(p.re, (match) => {
      if (p.luhn) {
        const digits = match.replace(/\D/g, "");
        if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return match;
      }
      hits.push(p.name);
      return level === "full" ? p.full(match) : p.partial(match);
    });
  }
  return { value: out, hits };
}

function maskRowList(rows, level) {
  const counts = {};
  if (!Array.isArray(rows)) return { rows, counts };
  const masked = rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const out = { ...row };
    for (const [k, v] of Object.entries(row)) {
      const { value, hits } = maskString(v, level);
      out[k] = value;
      for (const h of hits) counts[h] = (counts[h] || 0) + 1;
    }
    return out;
  });
  return { rows: masked, counts };
}

const ROLE_LEVEL = {
  admin: null, // no masking
  reader: "partial",
  reader_restricted: "full",
  metadata_only: null, // never returns row data anyway
  semantic_only: null, // zero tools registered — guardrail never fires for this role
};

export const outputPiiMask = {
  name: "output_pii_mask",
  kind: "post",
  async evaluate(ctx, _toolName, _args, result) {
    const level = ROLE_LEVEL[ctx.role];
    if (!level) return { result };
    if (!result || typeof result !== "object") return { result };

    let totalCounts = {};
    const out = { ...result };

    // Apply masking to every row-shaped field this tool's result might use.
    for (const field of ["rows", "hits", "values"]) {
      if (Array.isArray(result[field])) {
        const { rows, counts } = maskRowList(result[field], level);
        out[field] = rows;
        for (const [k, v] of Object.entries(counts)) {
          totalCounts[k] = (totalCounts[k] || 0) + v;
        }
      }
    }

    const totalHits = Object.values(totalCounts).reduce((a, b) => a + b, 0);
    if (totalHits === 0) return { result: out };

    return {
      result: out,
      event: {
        guardrail: "output_pii_mask",
        action: "transform",
        reason: `masked ${totalHits} field${totalHits === 1 ? "" : "s"} at level=${level}`,
        details: { level, hits: totalCounts },
      },
    };
  },
};
