/**
 * `warehouse-mcp start` — boot the server.
 *
 * The actual server bootstrap lives in src/index.js; importing it executes
 * its top-level main() side-effect. Keeping start as a thin shim means CLI
 * users and direct `node src/index.js` users get identical behavior.
 */
export async function startCommand() {
  await import("../index.js");
}
