import { z } from "zod";
import { normalizeReadOnlySql } from "../security/sqlValidator.js";
import { getAdapter } from "../adapters/index.js";

export const queryTool = {
  name: "query",
  description:
    "Execute a single read-only SELECT against the configured warehouse. Returns columns and rows. A LIMIT (or FETCH FIRST on Oracle) is auto-applied if the SQL omits one.",
  inputSchema: {
    sql: z.string().min(1).describe("Read-only SQL SELECT statement."),
    max_rows: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Optional row cap; rejected if it exceeds the server hard maximum."),
  },
  async handler(args, ctx, deps) {
    const adapter = await getAdapter(ctx, deps.provider);
    const safety = deps.provider.getSafetyConfig();
    const safe = normalizeReadOnlySql(args.sql, {
      dialect: adapter.type,
      defaultLimit: args.max_rows ?? safety.defaultLimit,
      maxLimit: safety.hardMaxLimit,
    });
    return adapter.query(safe);
  },
};
