import { queryTool } from "./query.js";
import { listSchemasTool, listTablesTool, describeTableTool } from "./catalog.js";
import { sampleTableTool, columnStatsTool, topValuesTool } from "./profile.js";
import { searchValueTool } from "./search.js";

/**
 * The eight v1 tools the server exposes. Order matters only for documentation
 * purposes — the MCP `tools/list` response preserves insertion order, and we
 * lead with the highest-value primitives.
 */
export const TOOL_DEFINITIONS = [
  queryTool,
  listSchemasTool,
  listTablesTool,
  describeTableTool,
  sampleTableTool,
  columnStatsTool,
  topValuesTool,
  searchValueTool,
];
