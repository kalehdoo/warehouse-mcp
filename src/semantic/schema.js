/**
 * Zod schemas for the semantic-metadata YAML format.
 *
 * Two file shapes:
 *   - glossary.yml   — business-glossary terms (one per file, one file total)
 *   - <anything>.yml — dbt-style schema.yml describing models (tables) + columns
 *
 * The format is intentionally a near-superset of dbt's schema.yml so that
 * dbt-using customers can reuse what they already have. Extensions live
 * under `meta:` so they coexist with vanilla dbt without confusing dbt's
 * own parser.
 */
import { z } from "zod";

// ── Common building blocks ────────────────────────────────────────────────

const Identifier = z.string().min(1).max(128);

// Free-form `meta` block — both at the model and column level.
// Reserved keys carry semantic meaning to warehouse-mcp; everything else
// passes through untouched (so customers can stash project-specific tags).
const ColumnMeta = z
  .object({
    sensitivity: z.enum(["low", "medium", "high", "secret"]).optional(),
    unit: z.string().optional(),
    glossary_terms: z.array(Identifier).optional(),
    deprecated: z.boolean().optional(),
    sample_values: z.array(z.string()).optional(),
    allowed_values: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

const ColumnDoc = z.object({
  name: Identifier,
  description: z.string().min(1),
  meta: ColumnMeta.optional(),
});

const ModelMeta = z
  .object({
    schema: Identifier.describe(
      "REQUIRED — the warehouse schema this table lives in (e.g. 'finance', 'public'). " +
        "Without this, warehouse-mcp can't route URIs to the right resource. " +
        "If you're importing a dbt project, set this from the model's target schema config.",
    ),
    owner: z.string().optional(),
    refresh: z
      .enum(["realtime", "hourly", "daily", "weekly", "monthly", "manual", "view"])
      .optional(),
    sensitivity: z.enum(["low", "medium", "high", "secret"]).optional(),
    glossary_terms: z.array(Identifier).optional(),
    purpose: z.enum(["raw", "staging", "intermediate", "mart", "snapshot", "reference"]).optional(),
  })
  .catchall(z.unknown());

const ModelDoc = z.object({
  name: Identifier,
  description: z.string().min(1),
  meta: ModelMeta,
  columns: z.array(ColumnDoc).default([]),
});

// ── File-level schemas ────────────────────────────────────────────────────

/**
 * Schema-style YAML files. Format mirrors dbt's `schema.yml`:
 * a `version` field plus a `models` array. Each model documents one warehouse table.
 */
export const ModelsFileSchema = z.object({
  version: z.literal(2).describe("Mirrors dbt's schema.yml v2 format."),
  models: z.array(ModelDoc).default([]),
});

/**
 * Business glossary file. Lives in `glossary.yml` at the root of SEMANTIC_DIR.
 */
const GlossaryTerm = z.object({
  name: Identifier,
  definition: z.string().min(1),
  sql_definition: z
    .string()
    .optional()
    .describe(
      "Optional canonical SQL the agent can use as a starting point — for example, " +
        "the exact predicate for 'active customer' or the formula for 'MRR'. Read-only " +
        "advisory; the validator still enforces read-only at execution time.",
    ),
  related_terms: z.array(Identifier).optional(),
  tags: z.array(Identifier).optional(),
});

export const GlossaryFileSchema = z.object({
  version: z.literal(1),
  terms: z.array(GlossaryTerm).default([]),
});

// ── Exports for consumers ─────────────────────────────────────────────────

export const TYPES = {
  ModelsFileSchema,
  GlossaryFileSchema,
};
