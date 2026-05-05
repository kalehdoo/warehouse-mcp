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
