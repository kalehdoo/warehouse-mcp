/**
 * DuckDB adapter — minimal v1 implementation, sufficient for the smoke test
 * (boot the server with WAREHOUSE_TYPE=duckdb and respond to tools/list).
 *
 * Phase 3 will flesh out richer metadata, type mapping, and error handling for
 * real customer use. For Phase 2 we just need the contract to be satisfied so
 * the server boots and the MCP transport can serve discovery requests.
 */
import duckdb from "duckdb";

function runAll(conn, sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

export function createDuckDbAdapter(config) {
  const path = config.path || ":memory:";
  const db = new duckdb.Database(path);
  const conn = db.connect();

  return {
    type: "duckdb",
    async query(sql) {
      const rows = await runAll(conn, sql);
      const columns =
        rows[0]
          ? Object.keys(rows[0]).map((name) => ({ name, type: typeof rows[0][name] }))
          : [];
      return { columns, rows };
    },
    async listSchemas() {
      const rows = await runAll(
        conn,
        "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
      );
      return rows.map((r) => r.schema_name);
    },
    async listTables(schema) {
      const rows = await runAll(
        conn,
        `SELECT table_name AS name, table_type AS kind
         FROM information_schema.tables
         WHERE table_schema = '${schema.replace(/'/g, "''")}'
         ORDER BY table_name`,
      );
      return rows.map((r) => ({
        schema,
        name: r.name,
        kind: String(r.kind).toLowerCase().includes("view") ? "view" : "table",
      }));
    },
    async describeTable(schema, table) {
      const rows = await runAll(
        conn,
        `SELECT column_name AS name, data_type AS type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = '${schema.replace(/'/g, "''")}'
           AND table_name = '${table.replace(/'/g, "''")}'
         ORDER BY ordinal_position`,
      );
      return rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.is_nullable === "YES",
      }));
    },
    async sample(schema, table, n) {
      return this.query(
        `SELECT * FROM "${schema}"."${table}" USING SAMPLE ${Math.min(n, 100)} ROWS`,
      );
    },
    async close() {
      conn.close?.();
      db.close?.();
    },
  };
}
