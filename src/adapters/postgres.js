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
    // Cancels the query at the server after this many ms (statement_timeout).
    // Adapter-wide; per-tool override is a v1.x concern.
    query_timeout: config.timeoutMs || 30_000,
    statement_timeout: config.timeoutMs || 30_000,
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

    async query(sql, opts = {}) {
      // Without warehouseRole the fast path runs on the pool directly — one
      // round-trip. With warehouseRole we check out a client, issue SET ROLE,
      // run the user query, RESET ROLE, then release the client back to the
      // pool. Three round-trips total, but the warehouse's own RLS / CLS /
      // masking policies now evaluate under the impersonated identity.
      if (!opts.warehouseRole) {
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
      }

      // Reject anything that doesn't look like a plain SQL identifier so an
      // attacker can't smuggle SQL through the warehouseRole field even if
      // upstream sanitization is bypassed.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(opts.warehouseRole)) {
        throw new WarehouseError(
          "PERMISSION_DENIED",
          `Invalid warehouseRole identifier: ${opts.warehouseRole}`,
          { warehouse: type },
        );
      }

      let client;
      try {
        client = await pool.connect();
      } catch (e) {
        throw wrapError(e, "CONNECTION_FAILED", `${type} client checkout failed`, type);
      }
      try {
        await client.query(`SET ROLE "${opts.warehouseRole}"`);
        const result = await client.query(sql);
        const columns = (result.fields || []).map((f) => ({
          name: f.name,
          type: pgTypeName(f.dataTypeID),
        }));
        return { columns, rows: result.rows };
      } catch (e) {
        throw wrapError(e, "QUERY_FAILED", `${type} query failed (role=${opts.warehouseRole})`, type);
      } finally {
        try {
          await client.query("RESET ROLE");
        } catch {
          // best effort — pool will discard the client if it errored
        }
        client.release();
      }
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

    async sample(schema, table, n, opts) {
      const limit = Math.max(1, Math.min(n, 100));
      return this.query(
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${limit}`,
        opts,
      );
    },

    async findColumns(pattern, { schema } = {}) {
      const params = [pattern];
      let where = `column_name ILIKE $1
                   AND table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
                   AND table_schema NOT LIKE 'pg_temp_%'
                   AND table_schema NOT LIKE 'pg_toast_temp_%'`;
      if (schema) {
        params.push(schema);
        where += ` AND table_schema = $2`;
      }
      try {
        const result = await pool.query(
          `SELECT table_schema AS schema, table_name AS "table",
                  column_name AS "column", data_type AS "type"
           FROM information_schema.columns
           WHERE ${where}
           ORDER BY schema, "table", "column"`,
          params,
        );
        return result.rows;
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} findColumns failed`, type);
      }
    },

    async getForeignKeys({ schema, table } = {}) {
      const params = [];
      const conds = [];
      if (schema) {
        params.push(schema);
        conds.push(`tc.table_schema = $${params.length}`);
      }
      if (table) {
        params.push(table);
        conds.push(`tc.table_name = $${params.length}`);
      }
      const whereClause = conds.length ? `AND ${conds.join(" AND ")}` : "";
      try {
        const result = await pool.query(
          `SELECT tc.table_schema   AS from_schema,
                  tc.table_name     AS from_table,
                  kcu.column_name   AS from_column,
                  ccu.table_schema  AS to_schema,
                  ccu.table_name    AS to_table,
                  ccu.column_name   AS to_column,
                  tc.constraint_name
           FROM information_schema.table_constraints AS tc
           JOIN information_schema.key_column_usage AS kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           JOIN information_schema.constraint_column_usage AS ccu
             ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
           WHERE tc.constraint_type = 'FOREIGN KEY'
             ${whereClause}
           ORDER BY from_schema, from_table, from_column`,
          params,
        );
        return result.rows;
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} getForeignKeys failed`, type);
      }
    },

    async getViewDefinition(schema, view) {
      let result;
      try {
        result = await pool.query(
          `SELECT view_definition AS sql
           FROM information_schema.views
           WHERE table_schema = $1 AND table_name = $2`,
          [schema, view],
        );
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", `${type} getViewDefinition failed`, type);
      }
      if (result.rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `View ${schema}.${view} not found in ${type}.`,
          { warehouse: type },
        );
      }
      return result.rows[0].sql;
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
