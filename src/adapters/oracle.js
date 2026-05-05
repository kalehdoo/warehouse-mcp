/**
 * Oracle adapter.
 *
 * Defaults to oracledb's "Thin mode" (pure JS, no Instant Client required).
 * Schemas in Oracle == users; we list non-system users via ALL_USERS and
 * read object metadata from ALL_TABLES / ALL_VIEWS / ALL_TAB_COLUMNS so the
 * adapter works for any user with SELECT on the catalog.
 *
 * Important: Oracle has no LIMIT keyword. The shared SQL validator
 * (src/security/sqlValidator.js) routes 'oracle' through FETCH FIRST n ROWS ONLY.
 * Anything Oracle-specific that the validator can't enforce lives here.
 */
import oracledb from "oracledb";
import { WarehouseError, wrapError } from "./errors.js";

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildPoolAttrs(config) {
  return {
    user: config.user,
    password: config.password,
    connectString: config.connectString,
    walletLocation: config.walletLocation,
    walletPassword: config.walletPassword,
    poolMin: 1,
    poolMax: config.maxConnections || 10,
    poolIncrement: 1,
    poolTimeout: 60,
  };
}

export function createOracleAdapter(config) {
  let poolPromise;

  async function getPool() {
    if (!poolPromise) {
      poolPromise = oracledb
        .createPool(buildPoolAttrs(config))
        .catch((e) => {
          poolPromise = undefined;
          throw wrapError(e, "CONNECTION_FAILED", "Failed to open Oracle pool", "oracle");
        });
    }
    return poolPromise;
  }

  async function withConnection(fn, errorCode, errorMsg) {
    const pool = await getPool();
    let conn;
    try {
      conn = await pool.getConnection();
    } catch (e) {
      throw wrapError(e, "CONNECTION_FAILED", "Failed to get Oracle connection", "oracle");
    }
    if (config.timeoutMs) {
      // oracledb cancels the round-trip if the call takes longer than this.
      conn.callTimeout = config.timeoutMs;
    }
    try {
      return await fn(conn);
    } catch (e) {
      throw wrapError(e, errorCode, errorMsg, "oracle");
    } finally {
      try {
        await conn.close();
      } catch {
        // ignore
      }
    }
  }

  return {
    type: "oracle",

    async query(sql) {
      return withConnection(
        async (conn) => {
          const result = await conn.execute(sql, [], { resultSet: false });
          const columns = (result.metaData || []).map((m) => ({
            name: m.name,
            type: oracleTypeName(m.dbType),
          }));
          return { columns, rows: result.rows || [] };
        },
        "QUERY_FAILED",
        "Oracle query failed",
      );
    },

    async listSchemas() {
      return withConnection(
        async (conn) => {
          // ALL_USERS.ORACLE_MAINTAINED filters out system users on 12c+.
          // Fall back if the column is unavailable on older versions.
          let result;
          try {
            result = await conn.execute(
              `SELECT username FROM all_users
               WHERE oracle_maintained = 'N'
               ORDER BY username`,
            );
          } catch {
            result = await conn.execute(
              `SELECT username FROM all_users
               WHERE username NOT IN ('SYS','SYSTEM','OUTLN','XDB','MDSYS','CTXSYS','ORDSYS','DBSNMP','APPQOSSYS','GSMADMIN_INTERNAL','AUDSYS','LBACSYS','OJVMSYS','WMSYS','DVSYS','REMOTE_SCHEDULER_AGENT')
               ORDER BY username`,
            );
          }
          return result.rows.map((r) => r.USERNAME);
        },
        "CATALOG_FAILED",
        "Oracle listSchemas failed",
      );
    },

    async listTables(schema) {
      return withConnection(
        async (conn) => {
          const result = await conn.execute(
            `SELECT table_name AS name, 'TABLE' AS kind FROM all_tables WHERE owner = :owner
             UNION ALL
             SELECT view_name AS name, 'VIEW' AS kind FROM all_views WHERE owner = :owner
             ORDER BY name`,
            { owner: schema },
          );
          return result.rows.map((r) => ({
            schema,
            name: r.NAME,
            kind: r.KIND === "VIEW" ? "view" : "table",
          }));
        },
        "CATALOG_FAILED",
        "Oracle listTables failed",
      );
    },

    async describeTable(schema, table) {
      const rows = await withConnection(
        async (conn) => {
          const result = await conn.execute(
            `SELECT column_name AS name, data_type AS type, nullable
             FROM all_tab_columns
             WHERE owner = :owner AND table_name = :tbl
             ORDER BY column_id`,
            { owner: schema, tbl: table },
          );
          return result.rows;
        },
        "CATALOG_FAILED",
        "Oracle describeTable failed",
      );
      if (rows.length === 0) {
        throw new WarehouseError(
          "NOT_FOUND",
          `Table ${schema}.${table} not found in Oracle.`,
          { warehouse: "oracle" },
        );
      }
      return rows.map((r) => ({
        name: r.NAME,
        type: r.TYPE,
        nullable: r.NULLABLE === "Y",
      }));
    },

    async sample(schema, table, n) {
      const limit = Math.max(1, Math.min(n, 100));
      return this.query(
        `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} FETCH FIRST ${limit} ROWS ONLY`,
      );
    },

    async close() {
      if (!poolPromise) return;
      try {
        const pool = await poolPromise;
        await pool.close(0);
      } catch {
        // ignore
      }
      poolPromise = undefined;
    },
  };
}

/**
 * Map oracledb.dbType numeric constants to readable names. Avoids importing the
 * full constants table on every column.
 */
function oracleTypeName(dbType) {
  const map = {
    [oracledb.DB_TYPE_VARCHAR]: "varchar2",
    [oracledb.DB_TYPE_NVARCHAR]: "nvarchar2",
    [oracledb.DB_TYPE_CHAR]: "char",
    [oracledb.DB_TYPE_NCHAR]: "nchar",
    [oracledb.DB_TYPE_NUMBER]: "number",
    [oracledb.DB_TYPE_BINARY_FLOAT]: "binary_float",
    [oracledb.DB_TYPE_BINARY_DOUBLE]: "binary_double",
    [oracledb.DB_TYPE_DATE]: "date",
    [oracledb.DB_TYPE_TIMESTAMP]: "timestamp",
    [oracledb.DB_TYPE_TIMESTAMP_TZ]: "timestamp_tz",
    [oracledb.DB_TYPE_TIMESTAMP_LTZ]: "timestamp_ltz",
    [oracledb.DB_TYPE_RAW]: "raw",
    [oracledb.DB_TYPE_BLOB]: "blob",
    [oracledb.DB_TYPE_CLOB]: "clob",
    [oracledb.DB_TYPE_NCLOB]: "nclob",
    [oracledb.DB_TYPE_JSON]: "json",
  };
  return map[dbType] || `oracle:${dbType}`;
}
