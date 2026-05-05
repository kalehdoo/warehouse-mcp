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

    async close() {
      // BigQuery client uses HTTPS keep-alive under the hood; no explicit close needed.
    },
  };
}
