/**
 * Semantic-metadata public API.
 *
 * - loadSemantic({dir})   load + validate the customer's SEMANTIC_DIR; returns an index.
 *                         Throws on schema or collision errors.
 *                         Returns an empty index when dir is unset/missing.
 * - registerSemanticResources(server, index)  attach MCP resources to a server.
 * - summarize(index)      one-line stats string for boot logging / doctor.
 */
import { existsSync, statSync } from "node:fs";
import { loadSemanticDir, emptyIndex, summarize } from "./loader.js";
import { registerSemanticResources } from "./resources.js";

/**
 * Load + validate the customer's semantic directory. Returns an empty index
 * (and registers no resources) if the directory is unset or missing — the
 * semantic layer is fully optional.
 *
 * @param {{dir?: string}} options
 */
export function loadSemantic({ dir } = {}) {
  if (!dir) return { index: emptyIndex(), enabled: false };
  if (!existsSync(dir)) {
    return { index: emptyIndex(), enabled: false, missingDir: dir };
  }
  if (!statSync(dir).isDirectory()) {
    throw new Error(`SEMANTIC_DIR=${dir} exists but is not a directory.`);
  }
  return { index: loadSemanticDir(dir), enabled: true };
}

export { registerSemanticResources, summarize };
