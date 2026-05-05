/**
 * Role-based tool authorization.
 *
 * v1 ships two roles out of the box:
 *  - admin  — every tool, including future write tools (gated by ENABLE_WRITE_TOOLS)
 *  - reader — read-only catalog + query tools
 *
 * Roles can be customized via a security policy file in a future phase.
 */

const READER_TOOLS = new Set([
  "query",
  "list_schemas",
  "list_tables",
  "describe_table",
  "find_columns",
  "get_foreign_keys",
  "get_view_definition",
  "sample_table",
  "count_rows",
  "column_stats",
  "top_values",
  "time_series",
  "search_value",
]);

const ADMIN_TOOLS = new Set([
  ...READER_TOOLS,
  // future write tools land here behind ENABLE_WRITE_TOOLS
]);

const ROLE_TOOLS = {
  admin: ADMIN_TOOLS,
  reader: READER_TOOLS,
  anonymous: READER_TOOLS,
};

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
