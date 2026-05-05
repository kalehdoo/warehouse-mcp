/**
 * Postgres adapter (also the basis for the Redshift adapter).
 *
 * Uses node-postgres pooling — one Pool per process per tenant. The pool
 * caps connections (default 10) and lazily creates them on demand.
 */
import pg from "pg";
import { WarehouseError, wrapError } from "./errors.js";

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildPoolConfig(config) {
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: config.maxConnections || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

/**
 * @param {object} config
 * @param {object} [overrides]  Lets the Redshift adapter reuse this with a different `type`.
 */
export function createPostgresAdapter(config, overrides = {}) {
  const type = overrides.type || "postgres";
  let pool;
  try {
    pool = new pg.Pool(buildPoolConfig(config));
  } catch (e) {
    throw wrapError(e, "CONNECTION_FAILED", `Failed to initialize ${type} pool`, type);
  }

  pool.on("error", (err) => {
    // Idle pool clients can emit unrecoverable errors; log via the pool itself
    // is not feasible here, so we just suppress to avoid crashing the process.
    // Active query errors propagate to the caller via pool.query().
    void err;
  });

  return {
    type,

    async query(sql) {
      let result;
      try {
        result = await pool.query(sql);
      } catch (e) {
        throw wrapError(e, "QUERY_FAILED", `${type} query failed`, type);
      }
      const columns = (result.fields || []).map((f) => ({
        name: f.name,
        type: pgTypeName(f.dataTypeID),
      }));
      return { columns, rows: result.rows };
    },

    async listSchemas() {
      try {
        const result = await pool.query(
          `SELECT schema_name FROM information_schema.schemata
           WHERE schema_name NOT IN ('pg_catalog','information_schema','pg_toast')
             AND schema_name NOT LIKE 'pg_temp_%'
             AND schema_name NOT LIKE 'pg_toast_temp_%'
           ORDER BY schema_name`,
        );
        return result.rows.map((r) => r.schema_name).filter((s) => !SYSTEM_SCHEMAS.has(s));
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} listSchemas failed`, type);
      }
    },

    async listTables(schema) {
      try {
        const result = await pool.query(
          `SELECT table_name AS name, table_type AS kind
           FROM information_schema.tables
           WHERE table_schema = $1
           ORDER BY table_name`,
          [schema],
        );
        return result.rows.map((r) => ({
          schema,
          name: r.name,
          kind: String(r.kind).toLowerCase().includes("view") ? "view" : "table",
        }));
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} listTables failed`, type);
      }
    },

    async describeTable(schema, table) {
      let result;
      try {
        result = await pool.query(
          `SELECT column_name AS name, data_type AS type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schema, table],
        );
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} describeTable failed`, type);
      }
      if (result.rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `Table ${schema}.${table} not found in ${type}.`,
          { warehouse: type },
        );
      }
      return result.rows.map((r) => ({
        name: r.name,
        type: r.type,
        nullable: r.is_nullable === "YES",
      }));
    },

    async sample(schema, table, n) {
      const limit = Math.max(1, Math.min(n, 100));
      return this.query(
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${limit}`,
      );
    },

    async close() {
      try {
        await pool.end();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Map a Postgres OID (pg_type.oid) to a human-readable type name. Covers the
 * common OIDs; falls back to "oid:N" for the long tail. Avoids a system-table
 * round trip on every query.
 */
function pgTypeName(oid) {
  const known = {
    16: "boolean",
    17: "bytea",
    20: "bigint",
    21: "smallint",
    23: "integer",
    25: "text",
    700: "real",
    701: "double",
    1042: "char",
    1043: "varchar",
    1082: "date",
    1083: "time",
    1114: "timestamp",
    1184: "timestamptz",
    1700: "numeric",
    2950: "uuid",
    3802: "jsonb",
    114: "json",
  };
  return known[oid] || `oid:${oid}`;
}
