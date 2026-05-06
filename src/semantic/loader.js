/**
 * Semantic-metadata loader.
 *
 * Walks SEMANTIC_DIR recursively, parses every *.yml / *.yaml as one of three
 * file shapes:
 *   - glossary.yml — business-glossary terms (one file at the root)
 *   - schemas.yml  — schema-level docs (one file at the root)
 *   - everything else — dbt-style schema.yml describing models (tables) + columns
 *
 * Each file is validated against the matching zod schema, then merged into an
 * in-memory index that resources.js queries against.
 *
 * Errors at startup if:
 *   - the same glossary term appears in more than one place
 *   - the same schema is documented twice (schemas.yml + duplicate)
 *   - the same (schema, table) appears in more than one models file
 *   - any file fails schema validation
 *
 * Fail-fast is the right default: the cost of a malformed semantic file is
 * the agent reading wrong metadata for the rest of the session.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";
import { ModelsFileSchema, GlossaryFileSchema, SchemasFileSchema } from "./schema.js";

/** @typedef {{ name: string, definition: string, sql_definition?: string, related_terms?: string[], tags?: string[] }} GlossaryTerm */
/** @typedef {{ name: string, description: string, owner?: string, refresh?: string, sensitivity?: string, purpose?: string, glossary_terms?: string[] }} SchemaDoc */
/** @typedef {{ name: string, description: string, meta: object, columns: object[] }} TableDoc */
/** @typedef {{ glossary: Map<string, GlossaryTerm>, schemaDocs: Map<string, SchemaDoc>, tables: Map<string, TableDoc>, schemas: Map<string, TableDoc[]> }} SemanticIndex */

const YAML_EXTS = new Set([".yml", ".yaml"]);

function walkYamlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkYamlFiles(path, acc);
      continue;
    }
    const lower = entry.toLowerCase();
    for (const ext of YAML_EXTS) {
      if (lower.endsWith(ext)) {
        acc.push(path);
        break;
      }
    }
  }
  return acc;
}

function parseYaml(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`Cannot read ${filePath}: ${e.message}`);
  }
  try {
    return yaml.load(raw);
  } catch (e) {
    throw new Error(`Invalid YAML in ${filePath}: ${e.message}`);
  }
}

function classify(filePath) {
  const name = basename(filePath).toLowerCase();
  if (name === "glossary.yml" || name === "glossary.yaml") return "glossary";
  if (name === "schemas.yml" || name === "schemas.yaml") return "schemas";
  return "models";
}

/**
 * Load the entire SEMANTIC_DIR into an index.
 *
 * @param {string} dir
 * @returns {SemanticIndex}
 */
export function loadSemanticDir(dir) {
  const files = walkYamlFiles(dir);

  const glossary = new Map();
  const schemaDocs = new Map();
  const tables = new Map();
  const sourceMap = new Map(); // (kind:key) -> originating file, for collision messages

  for (const filePath of files) {
    const kind = classify(filePath);
    const data = parseYaml(filePath);
    if (data == null) continue; // empty file is allowed

    if (kind === "glossary") {
      const parsed = GlossaryFileSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(
          `Schema validation failed for ${filePath}:\n${parsed.error.toString()}`,
        );
      }
      for (const term of parsed.data.terms) {
        const existing = sourceMap.get(`term:${term.name}`);
        if (existing) {
          throw new Error(
            `Glossary term '${term.name}' defined in both ${existing} and ${filePath}.`,
          );
        }
        glossary.set(term.name, term);
        sourceMap.set(`term:${term.name}`, filePath);
      }
      continue;
    }

    if (kind === "schemas") {
      const parsed = SchemasFileSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(
          `Schema validation failed for ${filePath}:\n${parsed.error.toString()}`,
        );
      }
      for (const doc of parsed.data.schemas) {
        const existing = sourceMap.get(`schema:${doc.name}`);
        if (existing) {
          throw new Error(
            `Schema '${doc.name}' documented in both ${existing} and ${filePath}.`,
          );
        }
        schemaDocs.set(doc.name, doc);
        sourceMap.set(`schema:${doc.name}`, filePath);
      }
      continue;
    }

    // kind === "models"
    const parsed = ModelsFileSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(
        `Schema validation failed for ${filePath}:\n${parsed.error.toString()}`,
      );
    }
    for (const model of parsed.data.models) {
      const key = `${model.meta.schema}.${model.name}`;
      const existing = sourceMap.get(`table:${key}`);
      if (existing) {
        throw new Error(
          `Table '${key}' defined in both ${existing} and ${filePath}.`,
        );
      }
      tables.set(key, model);
      sourceMap.set(`table:${key}`, filePath);
    }
  }

  // Derive schemas index — maps schema name to its tables.
  // A schema can appear in schemaDocs without any tables (and vice versa) —
  // unioning the keys keeps both kinds of partial documentation visible.
  const schemas = new Map();
  for (const model of tables.values()) {
    const schemaName = model.meta.schema;
    const list = schemas.get(schemaName) || [];
    list.push(model);
    schemas.set(schemaName, list);
  }
  for (const docName of schemaDocs.keys()) {
    if (!schemas.has(docName)) schemas.set(docName, []);
  }

  return { glossary, schemaDocs, tables, schemas };
}

/** Build an empty index — used when SEMANTIC_DIR is unset (no semantic resources). */
export function emptyIndex() {
  return {
    glossary: new Map(),
    schemaDocs: new Map(),
    tables: new Map(),
    schemas: new Map(),
  };
}

/**
 * Quick stats string for boot logging and `doctor` output.
 * @param {SemanticIndex} index
 */
export function summarize(index) {
  return (
    `${index.glossary.size} glossary terms, ${index.schemaDocs.size} documented schemas, ` +
    `${index.tables.size} tables across ${index.schemas.size} schemas`
  );
}
