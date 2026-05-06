/**
 * Register MCP resources backed by the semantic index.
 *
 * URI scheme:
 *   warehouse://semantic/glossary                   → all terms
 *   warehouse://semantic/glossary/{term}            → one term
 *   warehouse://semantic/schemas/list               → schemas + table-count summary
 *   warehouse://semantic/schemas/{schema}           → one schema's purpose + table list
 *   warehouse://semantic/tables/{schema}/{table}    → full table doc (description + columns + meta)
 *
 * AI clients fetch these proactively (resources are cacheable and discoverable
 * without needing a tool call), giving the agent the conceptual map of the
 * warehouse before it issues any operational queries.
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

const MIME_JSON = "application/json";

function jsonResource(uri, payload) {
  return {
    contents: [
      {
        uri: typeof uri === "string" ? uri : uri.href,
        mimeType: MIME_JSON,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function notFound(uri, message) {
  return {
    contents: [
      {
        uri: typeof uri === "string" ? uri : uri.href,
        mimeType: MIME_JSON,
        text: JSON.stringify({ error: "not_found", message }, null, 2),
      },
    ],
  };
}

/**
 * Register the five resource patterns on the MCP server. Idempotent — call
 * once per session at server-build time.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("./loader.js").SemanticIndex} index
 */
export function registerSemanticResources(server, index) {
  // Static URIs ────────────────────────────────────────────────────────────

  server.registerResource(
    "warehouse-glossary",
    "warehouse://semantic/glossary",
    {
      description:
        "Business glossary — domain terms with their definitions and (optionally) the SQL that implements them. Read this BEFORE answering data questions; it disambiguates words like 'active customer', 'revenue', 'MRR'.",
      mimeType: MIME_JSON,
    },
    async (uri) => jsonResource(uri, { terms: Array.from(index.glossary.values()) }),
  );

  server.registerResource(
    "warehouse-schemas-list",
    "warehouse://semantic/schemas/list",
    {
      description:
        "Schema overview — what each documented schema in the warehouse is for, who owns it, refresh cadence, sensitivity, and table count. Useful for understanding the warehouse layout before drilling into specific tables. Includes the schema-level docs from schemas.yml when present.",
      mimeType: MIME_JSON,
    },
    async (uri) => {
      const schemas = Array.from(index.schemas.entries()).map(([name, tables]) => {
        const doc = index.schemaDocs.get(name);
        return {
          name,
          // Schema-level docs from schemas.yml (when present) come first so the
          // agent learns the schemas purpose, not just its inventory.
          ...(doc
            ? {
                description: doc.description,
                owner: doc.owner,
                purpose: doc.purpose,
                refresh: doc.refresh,
                sensitivity: doc.sensitivity,
                glossary_terms: doc.glossary_terms,
              }
            : {}),
          table_count: tables.length,
          tables: tables.map((t) => t.name),
        };
      });
      return jsonResource(uri, { schemas });
    },
  );

  // Parameterized URIs (templates) ─────────────────────────────────────────

  server.registerResource(
    "warehouse-glossary-term",
    new ResourceTemplate("warehouse://semantic/glossary/{term}", { list: undefined }),
    {
      description: "One glossary term by name. Returns its definition and (if present) the SQL.",
      mimeType: MIME_JSON,
    },
    async (uri, { term }) => {
      const found = index.glossary.get(term);
      if (!found) return notFound(uri, `Glossary term '${term}' not found.`);
      return jsonResource(uri, found);
    },
  );

  server.registerResource(
    "warehouse-schema",
    new ResourceTemplate("warehouse://semantic/schemas/{schema}", { list: undefined }),
    {
      description:
        "Documentation for one schema — its purpose, owner, refresh cadence, sensitivity, and the tables it contains. Includes the schema-level doc from schemas.yml when present.",
      mimeType: MIME_JSON,
    },
    async (uri, { schema }) => {
      const tables = index.schemas.get(schema);
      const doc = index.schemaDocs.get(schema);
      if (!tables && !doc) {
        return notFound(uri, `Schema '${schema}' has no semantic documentation.`);
      }
      return jsonResource(uri, {
        schema,
        ...(doc
          ? {
              description: doc.description,
              owner: doc.owner,
              purpose: doc.purpose,
              refresh: doc.refresh,
              sensitivity: doc.sensitivity,
              glossary_terms: doc.glossary_terms,
            }
          : {}),
        table_count: (tables || []).length,
        tables: (tables || []).map((t) => ({
          name: t.name,
          description: t.description,
          purpose: t.meta?.purpose,
          owner: t.meta?.owner,
          sensitivity: t.meta?.sensitivity,
        })),
      });
    },
  );

  server.registerResource(
    "warehouse-table",
    new ResourceTemplate("warehouse://semantic/tables/{schema}/{table}", { list: undefined }),
    {
      description:
        "Full semantic doc for one table — description, owner, refresh cadence, sensitivity, and per-column descriptions / metadata. Read this BEFORE constructing a query against the table.",
      mimeType: MIME_JSON,
    },
    async (uri, { schema, table }) => {
      const found = index.tables.get(`${schema}.${table}`);
      if (!found) return notFound(uri, `Table '${schema}.${table}' has no semantic documentation.`);
      return jsonResource(uri, found);
    },
  );
}
