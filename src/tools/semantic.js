import { z } from "zod";

/**
 * Semantic-layer lookup tools. Thin tool-channel mirrors of the
 * warehouse://semantic/* resources, added because some MCP clients
 * (notably Claude Desktop) are tool-centric and don't surface
 * resource-only servers in their UI.
 *
 * Each handler is a pure in-memory Map lookup against the SemanticIndex
 * already loaded at boot — no warehouse I/O, no parsing on the request
 * path. Available to every role (cheap free read), and the only tools
 * registered for the `semantic_only` role.
 */

function noSemantic() {
  return {
    note: "Semantic layer not loaded or empty. Set SEMANTIC_DIR and restart.",
  };
}

export const glossaryLookupTool = {
  name: "glossary_lookup",
  description:
    "Look up business-glossary terms from the semantic layer. Call with no argument to list every term with a short definition. Call with `term` to get the full definition, optional SQL, related terms, and tags. Use this BEFORE writing SQL for domain questions — it disambiguates words like 'active customer', 'revenue', 'MRR'.",
  inputSchema: {
    term: z
      .string()
      .min(1)
      .optional()
      .describe("Glossary term name. Omit to list all terms."),
  },
  async handler(args, _ctx, deps) {
    const index = deps.semantic;
    if (!index || index.glossary.size === 0) return noSemantic();

    if (!args.term) {
      return {
        terms: Array.from(index.glossary.values()).map((t) => ({
          name: t.name,
          definition: t.definition,
        })),
      };
    }

    const found = index.glossary.get(args.term);
    if (!found) {
      return {
        error: "not_found",
        term: args.term,
        available_terms: Array.from(index.glossary.keys()),
      };
    }
    return found;
  },
};

export const schemaLookupTool = {
  name: "schema_lookup",
  description:
    "Look up schema-level documentation from the semantic layer. Call with no argument for a summary of every documented schema (purpose, owner, refresh cadence, sensitivity, table count). Call with `schema` for that schema's doc plus the list of documented tables in it. Use this to pick the right schema for a question before drilling into specific tables.",
  inputSchema: {
    schema: z
      .string()
      .min(1)
      .optional()
      .describe("Schema name. Omit to list all documented schemas."),
  },
  async handler(args, _ctx, deps) {
    const index = deps.semantic;
    if (!index || (index.schemas.size === 0 && index.schemaDocs.size === 0)) {
      return noSemantic();
    }

    if (!args.schema) {
      const schemas = Array.from(index.schemas.entries()).map(([name, tables]) => {
        const doc = index.schemaDocs.get(name);
        return {
          name,
          ...(doc
            ? {
                description: doc.description,
                owner: doc.owner,
                purpose: doc.purpose,
                refresh: doc.refresh,
                sensitivity: doc.sensitivity,
              }
            : {}),
          table_count: tables.length,
        };
      });
      return { schemas };
    }

    const tables = index.schemas.get(args.schema);
    const doc = index.schemaDocs.get(args.schema);
    if (!tables && !doc) {
      return {
        error: "not_found",
        schema: args.schema,
        available_schemas: Array.from(
          new Set([...index.schemas.keys(), ...index.schemaDocs.keys()]),
        ),
      };
    }
    return {
      schema: args.schema,
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
    };
  },
};

export const tableLookupTool = {
  name: "table_lookup",
  description:
    "Look up a documented table's full semantic profile — description, owner, refresh cadence, sensitivity, and per-column descriptions / metadata. Read this BEFORE constructing a query against the table. Both `schema` and `table` are required.",
  inputSchema: {
    schema: z.string().min(1).describe("Schema name."),
    table: z.string().min(1).describe("Table name within the schema."),
  },
  async handler(args, _ctx, deps) {
    const index = deps.semantic;
    if (!index || index.tables.size === 0) return noSemantic();

    const key = `${args.schema}.${args.table}`;
    const found = index.tables.get(key);
    if (!found) {
      return {
        error: "not_found",
        schema: args.schema,
        table: args.table,
        hint: `No semantic doc for '${key}'. Try schema_lookup('${args.schema}') to see documented tables.`,
      };
    }
    return found;
  },
};
