/**
 * Phase 2 ships the eight v1 tools as zod-schemed stubs so `tools/list` works
 * end-to-end and clients can discover the surface. Real handlers land in Phase 4
 * once the adapters in Phase 3 are wired.
 *
 * Each entry: { name, description, inputSchema (zod) }.
 */
import { z } from "zod";

const NotImplemented = (toolName) =>
  Promise.reject(
    new Error(`Tool '${toolName}' is not implemented yet — see Phase 4 of the build plan.`),
  );

export const TOOL_DEFINITIONS = [
  {
    name: "query",
    description:
      "Execute a single read-only SELECT against the configured warehouse. Returns columns and rows. A LIMIT (or FETCH FIRST on Oracle) is auto-applied if not present.",
    inputSchema: {
      sql: z.string().min(1).describe("Read-only SQL SELECT statement."),
      max_rows: z.number().int().positive().optional().describe("Optional row cap, capped by server config."),
    },
    handler: () => NotImplemented("query"),
  },
  {
    name: "list_schemas",
    description: "List all schemas in the configured warehouse.",
    inputSchema: {},
    handler: () => NotImplemented("list_schemas"),
  },
  {
    name: "list_tables",
    description: "List tables and views in a given schema.",
    inputSchema: {
      schema: z.string().min(1).describe("Schema name."),
    },
    handler: () => NotImplemented("list_tables"),
  },
  {
    name: "describe_table",
    description: "Return column names, types, and nullability for a table or view.",
    inputSchema: {
      schema: z.string().min(1),
      table: z.string().min(1),
    },
    handler: () => NotImplemented("describe_table"),
  },
  {
    name: "sample_table",
    description: "Return up to N sample rows from a table (capped at 100).",
    inputSchema: {
      schema: z.string().min(1),
      table: z.string().min(1),
      n: z.number().int().positive().max(100).default(10),
    },
    handler: () => NotImplemented("sample_table"),
  },
  {
    name: "column_stats",
    description: "Return min, max, average, null count, and distinct count for one column.",
    inputSchema: {
      schema: z.string().min(1),
      table: z.string().min(1),
      column: z.string().min(1),
    },
    handler: () => NotImplemented("column_stats"),
  },
  {
    name: "top_values",
    description: "Return the top-K most frequent values in a column with their counts.",
    inputSchema: {
      schema: z.string().min(1),
      table: z.string().min(1),
      column: z.string().min(1),
      k: z.number().int().positive().max(100).default(10),
    },
    handler: () => NotImplemented("top_values"),
  },
  {
    name: "search_value",
    description: "Find a literal value across the text columns of a table.",
    inputSchema: {
      schema: z.string().min(1),
      table: z.string().min(1),
      value: z.string().min(1),
    },
    handler: () => NotImplemented("search_value"),
  },
];
