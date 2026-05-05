/**
 * DuckDB adapter — used both as the local-demo backend and as the smoke-test
 * target for the contract suite. Operates against an in-process DuckDB instance.
 */
import duckdb from "duckdb";
import { WarehouseError, wrapError } from "./errors.js";

function runAll(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function escapeLiteral(value) {
  return String(value).replace(/'/g, "''");
}

export function createDuckDbAdapter(config) {
  const path = config.path || ":memory:";
  let db, conn;
  try {
    db = new duckdb.Database(path);
    conn = db.connect();
  } catch (e) {
    throw wrapError(e, "CONNECTION_FAILED", "Failed to open DuckDB", "duckdb");
  }

  return {
    type: "duckdb",

    async query(sql) {
      let rows;
      try {
        rows = await runAll(conn, sql);
      } catch (e) {
        throw wrapError(e, "QUERY_FAILED", "DuckDB query failed", "duckdb");
      }
      const columns = rows[0]
        ? Object.keys(rows[0]).map((name) => ({ name, type: typeof rows[0][name] }))
        : [];
      return { columns, rows };
    },

    async listSchemas() {
      try {
        const rows = await runAll(
          conn,
          `SELECT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog','information_schema','main_temp')
           ORDER BY schema_name`,
        );
        return rows.map((r) => r.schema_name);
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "DuckDB listSchemas failed", "duckdb");
      }
    },

    async listTables(schema) {
      try {
        const rows = await runAll(
          conn,
          `SELECT table_name AS name, table_type AS kind
           FROM information_schema.tables
           WHERE table_schema = '${escapeLiteral(schema)}'
           ORDER BY table_name`,
        );
        return rows.map((r) => ({
          schema,
          name: r.name,
          kind: String(r.kind).toLowerCase().includes("view") ? "view" : "table",
        }));
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "DuckDB listTables failed", "duckdb");
      }
    },

    async describeTable(schema, table) {
      let rows;
      try {
        rows = await runAll(
          conn,
          `SELECT column_name AS name, data_type AS type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = '${escapeLiteral(schema)}'
             AND table_name = '${escapeLiteral(table)}'
           ORDER BY ordinal_position`,
        );
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "DuckDB describeTable failed", "duckdb");
      }
      if (rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `Table ${schema}.${table} not found in DuckDB.`,
          { warehouse: "duckdb" },
        );
      }
      return rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.is_nullable === "YES",
      }));
    },

    async sample(schema, table, n) {
      const limit = Math.max(1, Math.min(n, 100));
      return this.query(
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} USING SAMPLE ${limit} ROWS`,
      );
    },

    async close() {
      try {
        conn.close?.();
      } catch {
        // ignore — duckdb close is sometimes a no-op
      }
      try {
        db.close?.();
      } catch {
        // ignore
      }
    },
  };
}
