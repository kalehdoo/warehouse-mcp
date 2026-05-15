/**
 * Role-based tool authorization.
 *
 * Five tiers in order of increasing access:
 *
 *   semantic_only    — zero tools registered. Pair with `semantic=on` so the
 *                      session sees the warehouse://semantic/* resources but
 *                      cannot invoke anything against the live warehouse.
 *                      Docs-viewer persona for non-technical stakeholders.
 *
 *   metadata_only    — schema/catalog discovery only. Never reads row data.
 *                      For agents that need to "map" the warehouse without
 *                      seeing actual values (compliance-heavy customers).
 *
 *   reader_restricted — metadata_only + aggregates / samples / time series.
 *                      Sees data but only in aggregated or sampled form. No
 *                      arbitrary SELECT, no literal-value search.
 *
 *   reader           — reader_restricted + arbitrary SELECT (`query`) and
 *                      literal search (`search_value`). The "general analyst"
 *                      tier; equivalent to v0.2.x's reader role.
 *
 *   admin            — every tool, including future write tools (gated by
 *                      ENABLE_WRITE_TOOLS).
 *
 * Custom roles can be added later via a security policy file; for v0.4 these
 * five cover the common ground.
 */

// Semantic-lookup tools — in-memory Map reads, no warehouse I/O. Available to
// every tier since they're effectively free; the `semantic_only` role gets
// these AND NOTHING ELSE.
const SEMANTIC_LOOKUP_TOOLS = new Set([
  "glossary_lookup",
  "schema_lookup",
  "table_lookup",
]);

const SEMANTIC_ONLY_TOOLS = new Set([...SEMANTIC_LOOKUP_TOOLS]);

const METADATA_TOOLS = new Set([
  ...SEMANTIC_LOOKUP_TOOLS,
  "list_schemas",
  "list_tables",
  "describe_table",
  "find_columns",
  "get_foreign_keys",
  "get_view_definition",
]);

const RESTRICTED_READ_TOOLS = new Set([
  ...METADATA_TOOLS,
  "sample_table",
  "count_rows",
  "column_stats",
  "top_values",
  "time_series",
]);

const READER_TOOLS = new Set([
  ...RESTRICTED_READ_TOOLS,
  "query",
  "search_value",
]);

const ADMIN_TOOLS = new Set([
  ...READER_TOOLS,
  // future write tools land here behind ENABLE_WRITE_TOOLS
]);

const ROLE_TOOLS = {
  semantic_only: SEMANTIC_ONLY_TOOLS,
  metadata_only: METADATA_TOOLS,
  reader_restricted: RESTRICTED_READ_TOOLS,
  reader: READER_TOOLS,
  admin: ADMIN_TOOLS,
};

export const VALID_ROLES = Object.keys(ROLE_TOOLS);

export function isToolAllowed(role, toolName) {
  const allowed = ROLE_TOOLS[role];
  if (!allowed) return false;
  return allowed.has(toolName);
}

/**
 * Throw if the context's role can't invoke this tool.
 * @param {{role: string}} ctx
 * @param {string} toolName
 */
export function assertToolAllowed(ctx, toolName) {
  if (!isToolAllowed(ctx.role, toolName)) {
    throw new Error(`Role '${ctx.role}' is not permitted to invoke '${toolName}'.`);
  }
}

export function listToolsForRole(role) {
  return Array.from(ROLE_TOOLS[role] || []);
}
