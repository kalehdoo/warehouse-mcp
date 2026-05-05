import { z } from "zod";
import { getAdapter } from "../adapters/index.js";
import {
  qualifiedTable,
  quoteIdent,
  quoteLiteral,
  limitClause,
  isTextType,
} from "../util/sqlDialect.js";
import { assertReadOnly } from "../security/sqlValidator.js";
import { WarehouseError } from "../adapters/errors.js";

const MAX_TEXT_COLS_TO_SCAN = 10;
const MAX_RESULT_ROWS = 100;

export const searchValueTool = {
  name: "search_value",
  description:
    "Find a literal value across the text columns of a table (exact match). Scans up to 10 text columns and returns up to 100 hits.",
  inputSchema: {
    schema: z.string().min(1),
    table: z.string().min(1),
    value: z.string().min(1).max(500).describe("Exact literal to match (case-sensitive)."),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const dialect = adapter.type;

    const cols = await adapter.describeTable(args.schema, args.table);
    const textCols = cols.filter((c) => isTextType(c.type)).slice(0, MAX_TEXT_COLS_TO_SCAN);
    if (textCols.length === 0) {
      throw new WarehouseError(
        "UNSUPPORTED",
        `No text columns found in ${args.schema}.${args.table} to search.`,
        { warehouse: dialect },
      );
    }

    const tbl = qualifiedTable(args.schema, args.table, dialect);
    const literal = quoteLiteral(args.value);
    const perColLimit = Math.max(1, Math.floor(MAX_RESULT_ROWS / textCols.length));

    const branches = textCols.map((col) => {
      const c = quoteIdent(col.name, dialect);
      const colLit = quoteLiteral(col.name);
      return (
        `SELECT ${colLit} AS column_name, ${c} AS value` +
        ` FROM ${tbl} WHERE ${c} = ${literal}` +
        ` ${limitClause(perColLimit, dialect)}`
      );
    });

    // Wrap each branch in a subselect so the per-branch LIMIT/FETCH applies
    // before the UNION ALL — required because some dialects (BigQuery, Oracle)
    // don't allow LIMIT inside UNION'd top-level SELECTs.
    const wrapped = branches.map((b) => `SELECT * FROM (${b}) sub`);
    const sql = wrapped.join(" UNION ALL ") + ` ${limitClause(MAX_RESULT_ROWS, dialect)}`;

    assertReadOnly(sql);
    const result = await adapter.query(sql);
    return {
      schema: args.schema,
      table: args.table,
      value: args.value,
      columns_scanned: textCols.map((c) => c.name),
      hits: result.rows,
    };
  },
};
