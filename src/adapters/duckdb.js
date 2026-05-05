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
  // The DuckDB driver auto-loads the MotherDuck extension when the path
  // starts with "md:" and reads the token from the motherduck_token env
  // var. We thread it through config so the adapter constructor remains
  // pure (no caller has to set the env var directly).
  if (config.motherduckToken) {
    process.env.motherduck_token = config.motherduckToken;
  }
  let db, conn;
  try {
    db = new duckdb.Database(path);
    conn = db.connect();
  } catch (e) {
    throw wrapError(e, "CONNECTION_FAILED", "Failed to open DuckDB", "duckdb");
  }

  return {
    type: "duckdb",

    async query(sql, opts) {
      if (opts?.warehouseRole) {
        throw new WarehouseError(
          "UNSUPPORTED",
          "DuckDB adapter does not support warehouse-role impersonation. Use Postgres or Redshift for this feature.",
          { warehouse: "duckdb" },
        );
      }
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
          `SELECT DISTINCT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog','information_schema','main_temp')
             AND catalog_name NOT IN ('system','temp')
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

    async findColumns(pattern, { schema } = {}) {
      const schemaFilter = schema
        ? `AND table_schema = '${escapeLiteral(schema)}'`
        : `AND table_schema NOT IN ('pg_catalog','information_schema','main_temp')`;
      try {
        const rows = await runAll(
          conn,
          `SELECT DISTINCT table_schema AS schema, table_name AS "table", column_name AS "column", data_type AS "type"
           FROM information_schema.columns
           WHERE column_name ILIKE '${escapeLiteral(pattern)}'
             ${schemaFilter}
           ORDER BY schema, "table", "column"`,
        );
        return rows.map((r) => ({
          schema: r.schema,
          table: r.table,
          column: r.column,
          type: r.type,
        }));
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "DuckDB findColumns failed", "duckdb");
      }
    },

    async getForeignKeys({ schema, table } = {}) {
      // duckdb_constraints() returns one row per constraint with referenced
      // table info already split out. We filter to FOREIGN_KEY constraints.
      try {
        const where = ["constraint_type = 'FOREIGN KEY'"];
        if (schema) where.push(`schema_name = '${escapeLiteral(schema)}'`);
        if (table) where.push(`table_name = '${escapeLiteral(table)}'`);
        const rows = await runAll(
          conn,
          `SELECT schema_name AS from_schema, table_name AS from_table,
                  constraint_column_names AS from_columns,
                  referenced_table AS to_table,
                  referenced_column_names AS to_columns,
                  constraint_name
           FROM duckdb_constraints()
           WHERE ${where.join(" AND ")}`,
        );
        // duckdb_constraints can return composite keys as arrays — flatten to one
        // edge per column pair so the contract output stays simple.
        const edges = [];
        for (const r of rows) {
          const fromCols = Array.isArray(r.from_columns) ? r.from_columns : [r.from_columns];
          const toCols = Array.isArray(r.to_columns) ? r.to_columns : [r.to_columns];
          for (let i = 0; i < fromCols.length; i++) {
            edges.push({
              from_schema: r.from_schema,
              from_table: r.from_table,
              from_column: fromCols[i],
              to_schema: r.from_schema, // DuckDB doesn't surface ref schema; assume same
              to_table: r.to_table,
              to_column: toCols[i],
              constraint_name: r.constraint_name,
            });
          }
        }
        return edges;
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "DuckDB getForeignKeys failed", "duckdb");
      }
    },

    async getViewDefinition(schema, view) {
      try {
        const rows = await runAll(
          conn,
          `SELECT sql FROM duckdb_views()
           WHERE schema_name = '${escapeLiteral(schema)}'
             AND view_name = '${escapeLiteral(view)}'`,
        );
        if (rows.length === 0) {
          throw new WarehouseError(
            "NOT_FOUND",
            `View ${schema}.${view} not found in DuckDB.`,
            { warehouse: "duckdb" },
          );
        }
        return rows[0].sql;
      } catch (e) {
        if (e instanceof WarehouseError) throw e;
        throw wrapError(e, "CATALOG_FAILED", "DuckDB getViewDefinition failed", "duckdb");
      }
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
