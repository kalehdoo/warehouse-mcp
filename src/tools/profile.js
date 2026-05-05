import { z } from "zod";
import { getAdapter } from "../adapters/index.js";
import {
  qualifiedTable,
  quoteIdent,
  limitClause,
  isNumericType,
} from "../util/sqlDialect.js";
import { assertReadOnly } from "../security/sqlValidator.js";
import { WarehouseError } from "../adapters/errors.js";

export const sampleTableTool = {
  name: "sample_table",
  description: "Return up to N sample rows from a table (capped at 100).",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
    n: z.number().int().positive().max(100).default(10),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    return adapter.sample(args.schema, args.table, args.n);
  },
};

async function findColumn(adapter, schema, table, column) {
  const cols = await adapter.describeTable(schema, table);
  const found = cols.find((c) => c.name.toLowerCase() === column.toLowerCase());
  if (!found) {
    throw new WarehouseError(
      "NOT_FOUND",
      `Column ${column} not found in ${schema}.${table}.`,
      { warehouse: adapter.type },
    );
  }
  return found;
}

export const columnStatsTool = {
  name: "column_stats",
  description:
    "Return min, max, null count, distinct count, and (for numeric columns) average for one column.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
    column: z.string().min(1),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const col = await findColumn(adapter, args.schema, args.table, args.column);
    const dialect = adapter.type;
    const tbl = qualifiedTable(args.schema, args.table, dialect);
    const c = quoteIdent(col.name, dialect);
    const numeric = isNumericType(col.type);
    const avgExpr = numeric ? `AVG(${c})` : "NULL";
    const sql =
      `SELECT COUNT(*) AS row_count,` +
      ` COUNT(${c}) AS non_null_count,` +
      ` COUNT(*) - COUNT(${c}) AS null_count,` +
      ` COUNT(DISTINCT ${c}) AS distinct_count,` +
      ` MIN(${c}) AS min_value,` +
      ` MAX(${c}) AS max_value,` +
      ` ${avgExpr} AS avg_value` +
      ` FROM ${tbl} ${limitClause(1, dialect)}`;
    assertReadOnly(sql);
    const result = await adapter.query(sql);
    return {
      schema: args.schema,
      table: args.table,
      column: col.name,
      type: col.type,
      stats: result.rows[0] || {},
    };
  },
};

export const topValuesTool = {
  name: "top_values",
  description: "Return the top-K most frequent non-null values in a column with their counts.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
    column: z.string().min(1),
    k: z.number().int().positive().max(100).default(10),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const col = await findColumn(adapter, args.schema, args.table, args.column);
    const dialect = adapter.type;
    const tbl = qualifiedTable(args.schema, args.table, dialect);
    const c = quoteIdent(col.name, dialect);
    const sql =
      `SELECT ${c} AS value, COUNT(*) AS count` +
      ` FROM ${tbl}` +
      ` WHERE ${c} IS NOT NULL` +
      ` GROUP BY ${c}` +
      ` ORDER BY COUNT(*) DESC` +
      ` ${limitClause(args.k, dialect)}`;
    assertReadOnly(sql);
    const result = await adapter.query(sql);
    return {
      schema: args.schema,
      table: args.table,
      column: col.name,
      values: result.rows,
    };
  },
};
