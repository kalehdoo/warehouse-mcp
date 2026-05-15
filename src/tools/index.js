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
import { glossaryLookupTool, schemaLookupTool, tableLookupTool } from "./semantic.js";

/**
 * Read-only tools the server exposes, grouped by intent. Insertion order is
 * preserved by MCP's `tools/list` response.
 *
 * Semantic-lookup tools are placed first so role-filtered registration makes
 * them the only tools `semantic_only` sees, and so they're top of the list for
 * tool-centric clients (Claude Desktop) where ordering nudges agent priors.
 */
export const TOOL_DEFINITIONS = [
  // Semantic lookups — in-memory Map reads, no warehouse I/O
  glossaryLookupTool,
  schemaLookupTool,
  tableLookupTool,
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
