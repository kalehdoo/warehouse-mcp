import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "./tools/registerAll.js";
import { registerSemanticResources } from "./semantic/index.js";

const SERVER_NAME = "warehouse-mcp";
const SERVER_VERSION = "0.4.0";

/**
 * Build a fresh MCP server instance bound to a single execution context.
 * The per-session server pattern (vs. a shared singleton) is intentional:
 * tool handlers close over the auth context, so each session gets its own
 * role/tenant/principal without us having to thread context through every call.
 *
 * @param {import("./auth/context.js").Context} ctx
 * @param {{
 *   provider?: object,
 *   audit?: import("./audit/jsonlSink.js").JsonlAuditSink,
 *   rateLimiter?: import("./security/rateLimit.js").TokenBucketRateLimiter,
 *   guardrails?: import("./guardrails/pipeline.js").GuardrailPipeline,
 *   semantic?: import("./semantic/loader.js").SemanticIndex,
 * }} [deps]
 */
export function buildServer(ctx, deps = {}) {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server, ctx, deps);
  // Three gates, all required: index has content, session opts in, and the
  // index dep was actually wired through. Per-session opt-in (ctx.includeSemantic)
  // is what lets two users on the same deployment disagree on whether they want
  // the semantic resources without restarting the server.
  if (
    ctx.includeSemantic !== false &&
    deps.semantic &&
    (deps.semantic.glossary?.size > 0 || deps.semantic.tables?.size > 0)
  ) {
    registerSemanticResources(server, deps.semantic);
  }
  return server;
}

export const META = { name: SERVER_NAME, version: SERVER_VERSION };
