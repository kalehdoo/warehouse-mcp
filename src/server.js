import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/registerAll.js";

const SERVER_NAME = "warehouse-mcp";
const SERVER_VERSION = "0.1.0";

/**
 * Build a fresh MCP server instance bound to a single execution context.
 * The per-session server pattern (vs. a shared singleton) is intentional:
 * tool handlers close over the auth context, so each session gets its own
 * role/tenant/principal without us having to thread context through every call.
 *
 * @param {import("./auth/context.js").Context} ctx
 * @param {{audit?: import("./audit/jsonlSink.js").JsonlAuditSink}} deps
 */
export function buildServer(ctx, deps = {}) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, ctx, deps);
  return server;
}

export const META = { name: SERVER_NAME, version: SERVER_VERSION };
