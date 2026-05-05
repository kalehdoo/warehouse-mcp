import { TOOL_DEFINITIONS } from "./index.js";
import { assertToolAllowed } from "../security/policy.js";
import { withSpan } from "../observability/otel.js";
import { applyResultCap } from "../util/resultCap.js";

/**
 * Register all v1 tools on the given McpServer instance.
 * The Context is captured by closure — each session has its own server + ctx.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("../auth/context.js").Context} ctx
 * @param {{
 *   provider: object,
 *   audit?: import("../audit/jsonlSink.js").JsonlAuditSink,
 *   rateLimiter?: import("../security/rateLimit.js").TokenBucketRateLimiter,
 * }} deps
 */
export function registerAllTools(server, ctx, deps = {}) {
  for (const def of TOOL_DEFINITIONS) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (args) =>
        withSpan(
          `tool.${def.name}`,
          async () => {
            const startedAt = Date.now();
            try {
              assertToolAllowed(ctx, def.name);
              deps.rateLimiter?.charge(ctx.principal);
              let result = await def.handler(args, ctx, deps);
              const maxCells = deps.provider?.getSafetyConfig?.()?.maxResultCells ?? 0;
              result = applyResultCap(result, maxCells);
              deps.audit?.write({
                ctx,
                tool: def.name,
                rowCount:
                  result?.rows?.length ?? result?.hits?.length ?? result?.values?.length,
                durationMs: Date.now() - startedAt,
                truncated: result?.truncated || undefined,
              });
              return {
                content: [
                  {
                    type: "text",
                    text:
                      typeof result === "string" ? result : JSON.stringify(result, null, 2),
                  },
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
          { "warehouse.tenant": ctx.tenantId, "warehouse.role": ctx.role },
        ),
    );
  }
}
