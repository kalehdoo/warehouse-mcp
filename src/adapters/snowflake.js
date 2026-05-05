/**
 * Snowflake adapter.
 *
 * Uses snowflake-sdk in callback mode wrapped in promises. Connections are
 * single-use; for v1 we keep a single long-lived connection per process and
 * serialize calls through it. A real pool can land later if the customer
 * needs concurrency beyond what one connection gives.
 *
 * Auth: key-pair (SNOWFLAKE_PRIVATE_KEY_PATH) is preferred. Username/password
 * is intentionally not supported in v1 — Snowflake is deprecating it.
 */
import { readFileSync } from "node:fs";
import snowflake from "snowflake-sdk";
import { WarehouseError, wrapError } from "./errors.js";

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildConnectionOpts(config) {
  if (!config.privateKeyPath) {
    throw new WarehouseError(
      "CONNECTION_FAILED",
      "Snowflake requires SNOWFLAKE_PRIVATE_KEY_PATH (key-pair auth). Password auth is not supported in v1.",
      { warehouse: "snowflake" },
    );
  }
  let privateKey;
  try {
    privateKey = readFileSync(config.privateKeyPath, "utf8");
  } catch (e) {
    throw wrapError(e, "CONNECTION_FAILED", "Failed to read Snowflake private key", "snowflake");
  }
  return {
    account: config.account,
    username: config.username,
    privateKey,
    authenticator: "SNOWFLAKE_JWT",
    warehouse: config.warehouse,
    database: config.database,
    schema: config.schema,
    role: config.role,
    // Cancels the request at the Snowflake side if it exceeds this many ms.
    timeout: config.timeoutMs || 30_000,
  };
}

function connect(conn) {
  return new Promise((resolve, reject) => {
    conn.connect((err) => (err ? reject(err) : resolve()));
  });
}

function execute(conn, sqlText, binds) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, stmt, rows) => {
        if (err) return reject(err);
        const columns = (stmt.getColumns() || []).map((c) => ({
          name: c.getName(),
          type: c.getType(),
        }));
        resolve({ columns, rows: rows || [] });
      },
    });
  });
}

export function createSnowflakeAdapter(config) {
  let connectionPromise;

  async function getConnection() {
    if (!connectionPromise) {
      const opts = buildConnectionOpts(config);
      const conn = snowflake.createConnection(opts);
      connectionPromise = connect(conn)
        .then(() => conn)
        .catch((e) => {
          connectionPromise = undefined;
          throw wrapError(e, "CONNECTION_FAILED", "Snowflake connect failed", "snowflake");
        });
    }
    return connectionPromise;
  }

  async function run(sqlText, binds, errorCode, errorMsg) {
    const conn = await getConnection();
    try {
      return await execute(conn, sqlText, binds);
    } catch (e) {
      throw wrapError(e, errorCode, errorMsg, "snowflake");
    }
  }

  return {
    type: "snowflake",

    async query(sql) {
      return run(sql, undefined, "QUERY_FAILED", "Snowflake query failed");
    },

    async listSchemas() {
      const result = await run(
        `SELECT schema_name AS NAME FROM information_schema.schemata
         WHERE schema_name NOT IN ('INFORMATION_SCHEMA')
         ORDER BY schema_name`,
        undefined,
        "CATALOG_FAILED",
        "Snowflake listSchemas failed",
      );
      return result.rows.map((r) => r.NAME);
    },

    async listTables(schema) {
      const result = await run(
        `SELECT table_name AS NAME, table_type AS KIND
         FROM information_schema.tables
         WHERE table_schema = ?
         ORDER BY table_name`,
        [schema],
        "CATALOG_FAILED",
        "Snowflake listTables failed",
      );
      return result.rows.map((r) => ({
        schema,
        name: r.NAME,
        kind: String(r.KIND).toLowerCase().includes("view") ? "view" : "table",
      }));
    },

    async describeTable(schema, table) {
      const result = await run(
        `SELECT column_name AS NAME, data_type AS TYPE, is_nullable AS NULLABLE
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ?
         ORDER BY ordinal_position`,
        [schema, table],
        "CATALOG_FAILED",
        "Snowflake describeTable failed",
      );
      if (result.rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `Table ${schema}.${table} not found in Snowflake.`,
          { warehouse: "snowflake" },
        );
      }
      return result.rows.map((r) => ({
        name: r.NAME,
        type: r.TYPE,
        nullable: r.NULLABLE === "YES",
      }));
    },

    async sample(schema, table, n) {
      const limit = Math.max(1, Math.min(n, 100));
      return this.query(
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} SAMPLE (${limit} ROWS)`,
      );
    },

    async findColumns(pattern, { schema } = {}) {
      const binds = [pattern];
      let where = `column_name ILIKE ?`;
      if (schema) {
        binds.push(schema);
        where += ` AND table_schema = ?`;
      } else {
        where += ` AND table_schema NOT IN ('INFORMATION_SCHEMA')`;
      }
      const result = await run(
        `SELECT table_schema AS SCHEMA, table_name AS "TABLE",
                column_name AS "COLUMN", data_type AS "TYPE"
         FROM information_schema.columns
         WHERE ${where}
         ORDER BY table_schema, table_name, column_name`,
        binds,
        "CATALOG_FAILED",
        "Snowflake findColumns failed",
      );
      return result.rows.map((r) => ({
        schema: r.SCHEMA,
        table: r.TABLE,
        column: r.COLUMN,
        type: r.TYPE,
      }));
    },

    async getForeignKeys({ schema, table } = {}) {
      const binds = [];
      const conds = [];
      if (schema) {
        binds.push(schema);
        conds.push(`tc.constraint_schema = ?`);
      }
      if (table) {
        binds.push(table);
        conds.push(`tc.table_name = ?`);
      }
      const where = conds.length ? `AND ${conds.join(" AND ")}` : "";
      const result = await run(
        `SELECT tc.table_schema   AS FROM_SCHEMA,
                tc.table_name     AS FROM_TABLE,
                kcu.column_name   AS FROM_COLUMN,
                ccu.table_schema  AS TO_SCHEMA,
                ccu.table_name    AS TO_TABLE,
                ccu.column_name   AS TO_COLUMN,
                tc.constraint_name AS CONSTRAINT_NAME
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.constraint_schema = kcu.constraint_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.constraint_schema = tc.constraint_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' ${where}
         ORDER BY tc.table_schema, tc.table_name, kcu.column_name`,
        binds,
        "CATALOG_FAILED",
        "Snowflake getForeignKeys failed",
      );
      return result.rows.map((r) => ({
        from_schema: r.FROM_SCHEMA,
        from_table: r.FROM_TABLE,
        from_column: r.FROM_COLUMN,
        to_schema: r.TO_SCHEMA,
        to_table: r.TO_TABLE,
        to_column: r.TO_COLUMN,
        constraint_name: r.CONSTRAINT_NAME,
      }));
    },

    async getViewDefinition(schema, view) {
      const result = await run(
        `SELECT view_definition AS SQL
         FROM information_schema.views
         WHERE table_schema = ? AND table_name = ?`,
        [schema, view],
        "CATALOG_FAILED",
        "Snowflake getViewDefinition failed",
      );
      if (result.rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `View ${schema}.${view} not found in Snowflake.`,
          { warehouse: "snowflake" },
        );
      }
      return result.rows[0].SQL;
    },

    async close() {
      if (!connectionPromise) return;
      try {
        const conn = await connectionPromise;
        await new Promise((resolve) => conn.destroy(() => resolve()));
      } catch {
        // ignore
      }
      connectionPromise = undefined;
    },
  };
}
