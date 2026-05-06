/**
 * Semantic-metadata loader.
 *
 * Walks SEMANTIC_DIR recursively, parses every *.yml / *.yaml as either the
 * glossary file (filename === "glossary.yml") or a dbt-style models file,
 * validates against the zod schema, and merges into an in-memory index that
 * resources.js queries against.
 *
 * Errors at startup if:
 *   - the same glossary term name appears in more than one place
 *   - the same (schema, table) appears in more than one models file
 *   - any file fails schema validation
 *
 * Fail-fast is the right default: the cost of a malformed semantic file is
 * the agent reading wrong metadata for the rest of the session.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";
import { ModelsFileSchema, GlossaryFileSchema } from "./schema.js";

/** @typedef {{ name: string, definition: string, sql_definition?: string, related_terms?: string[], tags?: string[] }} GlossaryTerm */
/** @typedef {{ name: string, description: string, meta: object, columns: object[] }} TableDoc */
/** @typedef {{ glossary: Map<string, GlossaryTerm>, tables: Map<string, TableDoc>, schemas: Map<string, TableDoc[]> }} SemanticIndex */

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

/**
 * Load the entire SEMANTIC_DIR into an index.
 *
 * @param {string} dir
 * @returns {SemanticIndex}
 */
export function loadSemanticDir(dir) {
  const files = walkYamlFiles(dir);

  const glossary = new Map();
  const tables = new Map();
  const sourceMap = new Map(); // (schema.table or term name) -> originating file, for collision messages

  for (const filePath of files) {
    const isGlossary = basename(filePath).toLowerCase() === "glossary.yml";
    const data = parseYaml(filePath);
    if (data == null) continue; // empty file is allowed

    if (isGlossary) {
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
  const schemas = new Map();
  for (const model of tables.values()) {
    const schemaName = model.meta.schema;
    const list = schemas.get(schemaName) || [];
    list.push(model);
    schemas.set(schemaName, list);
  }

  return { glossary, tables, schemas };
}

/** Build an empty index — used when SEMANTIC_DIR is unset (no semantic resources). */
export function emptyIndex() {
  return { glossary: new Map(), tables: new Map(), schemas: new Map() };
}

/**
 * Quick stats string for boot logging and `doctor` output.
 * @param {SemanticIndex} index
 */
export function summarize(index) {
  return `${index.glossary.size} glossary terms, ${index.tables.size} tables across ${index.schemas.size} schemas`;
}
