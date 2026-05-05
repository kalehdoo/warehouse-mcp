import { TOOL_DEFINITIONS } from "./stubs.js";
import { assertToolAllowed } from "../security/policy.js";

/**
 * Register all v1 tools on the given McpServer instance.
 * The Context is captured by closure — each session has its own server + ctx.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("../auth/context.js").Context} ctx
 * @param {{audit?: import("../audit/jsonlSink.js").JsonlAuditSink}} deps
 */
export function registerAllTools(server, ctx, deps = {}) {
  for (const def of TOOL_DEFINITIONS) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (args) => {
        const startedAt = Date.now();
        try {
          assertToolAllowed(ctx, def.name);
          const result = await def.handler(args, ctx, deps);
          deps.audit?.write({
            ctx,
            tool: def.name,
            rowCount: result?.rows?.length,
            durationMs: Date.now() - startedAt,
          });
          return {
            content: [
              { type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) },
            ],
          };
        } catch (e) {
          deps.audit?.write({
            ctx,
            tool: def.name,
            durationMs: Date.now() - startedAt,
            error: e.message,
          });
          return {
            isError: true,
            content: [{ type: "text", text: `Error: ${e.message}` }],
          };
        }
      },
    );
  }
}
