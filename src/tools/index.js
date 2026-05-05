import { queryTool } from "./query.js";
import {
  listSchemasTool,
  listTablesTool,
  describeTableTool,
  findColumnsTool,
  getForeignKeysTool,
  getViewDefinitionTool,
} from "./catalog.js";
import {
  sampleTableTool,
  columnStatsTool,
  topValuesTool,
  countRowsTool,
  timeSeriesTool,
} from "./profile.js";
import { searchValueTool } from "./search.js";

/**
 * The 13 read-only tools the server exposes. Order matters only for documentation
 * purposes — the MCP `tools/list` response preserves insertion order, and we
 * group by intent: query, catalog discovery, single-table profile, search.
 */
export const TOOL_DEFINITIONS = [
  // Free-form
  queryTool,
  // Catalog discovery
  listSchemasTool,
  listTablesTool,
  describeTableTool,
  findColumnsTool,
  getForeignKeysTool,
  getViewDefinitionTool,
  // Single-table profile
  sampleTableTool,
  countRowsTool,
  columnStatsTool,
  topValuesTool,
  timeSeriesTool,
  // Search
  searchValueTool,
];
