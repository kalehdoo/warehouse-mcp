/**
 * BigQuery adapter.
 *
 * Schemas in BigQuery == datasets. Auth is via service-account JSON
 * (GOOGLE_APPLICATION_CREDENTIALS) — same convention every other GCP SDK uses.
 *
 * The @google-cloud/bigquery client is async/await throughout, so this adapter
 * is the simplest of the cloud trio. Type info comes from the job's schema
 * metadata after execution; no extra round trip needed for column names.
 */
import { BigQuery } from "@google-cloud/bigquery";
import { WarehouseError, wrapError } from "./errors.js";

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, "")}\``;
}

export function createBigQueryAdapter(config) {
  let client;
  try {
    client = new BigQuery({
      projectId: config.projectId,
      keyFilename: config.keyFilename,
      location: config.location || "US",
    });
  } catch (e) {
    throw wrapError(e, "CONNECTION_FAILED", "Failed to create BigQuery client", "bigquery");
  }

  return {
    type: "bigquery",

    async query(sql) {
      let rows, job;
      try {
        [rows, job] = await client.query({
          query: sql,
          location: config.location || "US",
          // BigQuery aborts the job server-side after this many ms.
          jobTimeoutMs: config.timeoutMs || 30_000,
        });
      } catch (e) {
        throw wrapError(e, "QUERY_FAILED", "BigQuery query failed", "bigquery");
      }
      let columns = [];
      try {
        const [meta] = await job.getMetadata();
        const fields = meta?.statistics?.query?.schema?.fields || [];
        columns = fields.map((f) => ({ name: f.name, type: f.type }));
      } catch {
        if (rows[0]) columns = Object.keys(rows[0]).map((name) => ({ name, type: "unknown" }));
      }
      return { columns, rows };
    },

    async listSchemas() {
      try {
        const [datasets] = await client.getDatasets();
        return datasets.map((d) => d.id).sort();
      } catch (e) {
        throw wrapError(e, "CATALOG_FAILED", "BigQuery listSchemas failed", "bigquery");
      }
    },

    async listTables(schema) {
      try {
        const [tables] = await client.dataset(schema).getTables();
        return tables.map((t) => ({
          schema,
          name: t.id,
          kind: t.metadata?.type === "VIEW" ? "view" : "table",
        }));
      } catch (e) {
        if (e.code === 404) {
          throw new WarehouseError(
            "NOT_FOUND",
            `Dataset ${schema} not found in BigQuery.`,
            { warehouse: "bigquery", cause: e },
          );
        }
        throw wrapError(e, "CATALOG_FAILED", "BigQuery listTables failed", "bigquery");
      }
    },

    async describeTable(schema, table) {
      let metadata;
      try {
        [metadata] = await client.dataset(schema).table(table).getMetadata();
      } catch (e) {
        if (e.code === 404) {
          throw new WarehouseError(
            "NOT_FOUND",
            `Table ${schema}.${table} not found in BigQuery.`,
            { warehouse: "bigquery", cause: e },
          );
        }
        throw wrapError(e, "CATALOG_FAILED", "BigQuery describeTable failed", "bigquery");
      }
      const fields = metadata?.schema?.fields || [];
      return fields.map((f) => ({
        name: f.name,
        type: f.type,
        nullable: f.mode !== "REQUIRED",
      }));
    },

    async sample(schema, table, n) {
      const limit = Math.max(1, Math.min(n, 100));
      const ref = `${quoteIdent(config.projectId)}.${quoteIdent(schema)}.${quoteIdent(table)}`;
      return this.query(`SELECT * FROM ${ref} LIMIT ${limit}`);
    },

    async findColumns(pattern, { schema } = {}) {
      // BigQuery's INFORMATION_SCHEMA is per-dataset, not project-wide. If the
      // caller scopes to one schema we can hit one INFORMATION_SCHEMA. Without
      // a schema we'd have to loop across datasets — for v1 we require schema
      // when scanning BigQuery to keep cost bounded.
      if (!schema) {
        throw new WarehouseError(
          "UNSUPPORTED",
          "BigQuery findColumns requires a schema (dataset). Project-wide search is not supported in v1.",
          { warehouse: "bigquery" },
        );
      }
      const safe = String(pattern).replace(/'/g, "''");
      const result = await this.query(
        `SELECT table_schema AS schema, table_name AS \`table\`,
                column_name AS \`column\`, data_type AS \`type\`
         FROM \`${config.projectId}.${schema}.INFORMATION_SCHEMA.COLUMNS\`
         WHERE LOWER(column_name) LIKE LOWER('${safe}')
         ORDER BY table_name, column_name`,
      );
      return result.rows;
    },

    async getForeignKeys({ schema, table } = {}) {
      // BigQuery only supports informational PK/FK constraints. They live in
      // INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE. Most BigQuery tables
      // don't declare them at all; we return [] in that case rather than
      // erroring, so the agent gets a stable signal.
      if (!schema) {
        throw new WarehouseError(
          "UNSUPPORTED",
          "BigQuery getForeignKeys requires a schema (dataset).",
          { warehouse: "bigquery" },
        );
      }
      const conds = [`tc.constraint_type = 'FOREIGN KEY'`];
      if (table) {
        const t = String(table).replace(/'/g, "''");
        conds.push(`tc.table_name = '${t}'`);
      }
      try {
        const result = await this.query(
          `SELECT tc.table_schema AS from_schema,
                  tc.table_name   AS from_table,
                  kcu.column_name AS from_column,
                  ccu.table_schema AS to_schema,
                  ccu.table_name   AS to_table,
                  ccu.column_name  AS to_column,
                  tc.constraint_name
           FROM \`${config.projectId}.${schema}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS\` tc
           JOIN \`${config.projectId}.${schema}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE\` kcu
             ON tc.constraint_name = kcu.constraint_name
           JOIN \`${config.projectId}.${schema}.INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE\` ccu
             ON ccu.constraint_name = tc.constraint_name
           WHERE ${conds.join(" AND ")}
           ORDER BY tc.table_name, kcu.column_name`,
        );
        return result.rows;
      } catch (e) {
        // BigQuery FK metadata is GA but some legacy projects / regions may
        // lack the views — return [] gracefully rather than failing the call.
        if (/INFORMATION_SCHEMA|not found|does not exist/i.test(e.message || "")) return [];
        throw e;
      }
    },

    async getViewDefinition(schema, view) {
      let metadata;
      try {
        [metadata] = await client.dataset(schema).table(view).getMetadata();
      } catch (e) {
        if (e.code === 404) {
          throw new WarehouseError(
            "NOT_FOUND",
            `View ${schema}.${view} not found in BigQuery.`,
            { warehouse: "bigquery", cause: e },
          );
        }
        throw wrapError(e, "CATALOG_FAILED", "BigQuery getViewDefinition failed", "bigquery");
      }
      const sql = metadata?.view?.query;
      if (!sql) {
        throw new WarehouseError(
          "NOT_FOUND",
          `${schema}.${view} is not a view (or has no SQL definition).`,
          { warehouse: "bigquery" },
        );
      }
      return sql;
    },

    async close() {
      // BigQuery client uses HTTPS keep-alive under the hood; no explicit close needed.
    },
  };
}
