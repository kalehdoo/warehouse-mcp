import { z } from "zod";
import { getAdapter } from "../adapters/index.js";
import {
  qualifiedTable,
  quoteIdent,
  limitClause,
  isNumericType,
  dateTrunc,
  TIME_PERIODS,
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
    return adapter.sample(args.schema, args.table, args.n || 10, {
      warehouseRole: ctx.warehouseRole,
    });
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
    const result = await adapter.query(sql, { warehouseRole: ctx.warehouseRole });
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
    const result = await adapter.query(sql, { warehouseRole: ctx.warehouseRole });
    return {
      schema: args.schema,
      table: args.table,
      column: col.name,
      values: result.rows,
    };
  },
};

export const countRowsTool = {
  name: "count_rows",
  description:
    "Return the row count for a table. Cheap (single COUNT(*)), and answers 'how big is this?' before the agent decides whether to scan it. Especially useful on cloud warehouses where bytes scanned costs money.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const dialect = adapter.type;
    const tbl = qualifiedTable(args.schema, args.table, dialect);
    const sql = `SELECT COUNT(*) AS row_count FROM ${tbl}`;
    assertReadOnly(sql);
    const result = await adapter.query(sql, { warehouseRole: ctx.warehouseRole });
    const raw = result.rows[0]?.row_count ?? result.rows[0]?.ROW_COUNT;
    return {
      schema: args.schema,
      table: args.table,
      row_count: typeof raw === "bigint" ? Number(raw) : Number(raw ?? 0),
    };
  },
};

export const timeSeriesTool = {
  name: "time_series",
  description:
    "Group a table by a date/timestamp column into buckets (hour/day/week/month/quarter/year) and return a count or aggregate per bucket. Saves the agent from constructing dialect-specific date truncation. Returns rows ordered chronologically.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
    date_column: z.string().min(1).describe("Column to truncate to time buckets."),
    period: z.enum(TIME_PERIODS).default("day"),
    metric_column: z
      .string()
      .min(1)
      .optional()
      .describe("Optional numeric column to aggregate. Omit for plain COUNT(*)."),
    agg: z
      .enum(["count", "sum", "avg", "min", "max"])
      .default("count")
      .describe("Aggregate to compute per bucket. 'count' ignores metric_column."),
    limit: z.number().int().positive().max(1000).default(365),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const dialect = adapter.type;
    // Defensive defaults — production-time MCP applies the Zod schema, but
    // direct calls (tests, future programmatic use) bypass that layer.
    const period = args.period || "day";
    const agg = args.agg || "count";
    const limit = args.limit || 365;
    const tbl = qualifiedTable(args.schema, args.table, dialect);
    const dateCol = quoteIdent(args.date_column, dialect);
    const bucket = dateTrunc(period, dateCol, dialect);

    let aggExpr;
    if (agg === "count") {
      aggExpr = "COUNT(*)";
    } else {
      if (!args.metric_column) {
        throw new WarehouseError(
          "UNSUPPORTED",
          `Aggregate '${agg}' requires metric_column.`,
          { warehouse: dialect },
        );
      }
      const m = quoteIdent(args.metric_column, dialect);
      aggExpr = `${agg.toUpperCase()}(${m})`;
    }

    const sql =
      `SELECT ${bucket} AS period, ${aggExpr} AS value` +
      ` FROM ${tbl}` +
      ` WHERE ${dateCol} IS NOT NULL` +
      ` GROUP BY ${bucket}` +
      ` ORDER BY ${bucket}` +
      ` ${limitClause(limit, dialect)}`;

    assertReadOnly(sql);
    const result = await adapter.query(sql, { warehouseRole: ctx.warehouseRole });
    return {
      schema: args.schema,
      table: args.table,
      date_column: args.date_column,
      period: args.period,
      agg: args.agg,
      metric_column: args.metric_column,
      points: result.rows,
    };
  },
};
