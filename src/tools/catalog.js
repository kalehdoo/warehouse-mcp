import { z } from "zod";
import { getAdapter } from "../adapters/index.js";

export const listSchemasTool = {
  name: "list_schemas",
  description: "List all schemas (or BigQuery datasets) visible to the configured warehouse role.",
  inputSchema: {},
  async handler(_args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const schemas = await adapter.listSchemas();
    return { schemas };
  },
};

export const listTablesTool = {
  name: "list_tables",
  description: "List tables and views in a given schema.",
  inputSchema: {
    schema: z.string().min(1).describe("Schema name (case-sensitive on Oracle)."),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const tables = await adapter.listTables(args.schema);
    return { schema: args.schema, count: tables.length, tables };
  },
};

export const describeTableTool = {
  name: "describe_table",
  description: "Return column names, types, and nullability for a table or view.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const columns = await adapter.describeTable(args.schema, args.table);
    return { schema: args.schema, table: args.table, columns };
  },
};

export const findColumnsTool = {
  name: "find_columns",
  description:
    "Search column names across the warehouse using a SQL LIKE pattern (use % for wildcards). Returns matching (schema, table, column, type) tuples. Optionally scope to one schema. On BigQuery, schema is required because INFORMATION_SCHEMA is per-dataset.",
  inputSchema: {
    pattern: z
      .string()
      .min(1)
      .describe('SQL LIKE pattern. Examples: "%email%", "customer_id", "%_at".'),
    schema: z.string().min(1).optional().describe("Optional schema to limit the search."),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const matches = await adapter.findColumns(args.pattern, { schema: args.schema });
    return { pattern: args.pattern, schema: args.schema, count: matches.length, matches };
  },
};

export const getForeignKeysTool = {
  name: "get_foreign_keys",
  description:
    "Return declared foreign-key relationships (from_schema/from_table/from_column → to_schema/to_table/to_column). Optionally scope to a schema or a single table. BigQuery only returns informational FKs that were explicitly declared.",
  inputSchema: {
    schema: z.string().min(1).optional(),
    table: z.string().min(1).optional(),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const edges = await adapter.getForeignKeys({ schema: args.schema, table: args.table });
    return { schema: args.schema, table: args.table, count: edges.length, edges };
  },
};

export const getViewDefinitionTool = {
  name: "get_view_definition",
  description:
    "Return the SQL body of a view. Useful when business logic lives in views — the model can reason about a view's semantics by reading its definition.",
  inputSchema: {
    schema: z.string().min(1),
    view: z.string().min(1),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const sql = await adapter.getViewDefinition(args.schema, args.view);
    return { schema: args.schema, view: args.view, sql };
  },
};
