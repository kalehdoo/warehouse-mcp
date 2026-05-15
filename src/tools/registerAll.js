import { TOOL_DEFINITIONS } from "./index.js";
import { assertToolAllowed, isToolAllowed } from "../security/policy.js";
import { withSpan } from "../observability/otel.js";
import { applyResultCap } from "../util/resultCap.js";

/**
 * Register the tools allowed for this session's role on the given McpServer
 * instance. The Context is captured by closure — each session has its own
 * server + ctx, so each session sees a tools/list response shaped by its role.
 *
 * Tools the role isn't permitted to invoke aren't registered at all. This
 * means the agent's tool catalog ALREADY excludes disallowed tools — no more
 * "agent tries `query` as a metadata_only role and gets denied at call
 * time." `assertToolAllowed` inside the handler is kept as defense-in-depth
 * (e.g. against future code paths that bypass registration).
 *
 * Order of operations per tool call:
 *   1. assertToolAllowed (role policy — defense in depth)
 *   2. rateLimiter.charge
 *   3. guardrails pre-pipeline (deny / approve_required short-circuit)
 *   4. tool handler
 *   5. result cap
 *   6. guardrails post-pipeline (PII mask, etc.)
 *   7. audit log
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {import("../auth/context.js").Context} ctx
 * @param {{
 *   provider?: object,
 *   audit?: import("../audit/jsonlSink.js").JsonlAuditSink,
 *   rateLimiter?: import("../security/rateLimit.js").TokenBucketRateLimiter,
 *   guardrails?: import("../guardrails/pipeline.js").GuardrailPipeline,
 * }} [deps]
 */
export function registerAllTools(server, ctx, deps = {}) {
  for (const def of TOOL_DEFINITIONS) {
    if (!isToolAllowed(ctx.role, def.name)) {
      // Skip — the role can't invoke this tool, so don't even advertise it
      // in tools/list. Cleaner agent UX and a smaller audit footprint.
      continue;
    }
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
            const guardrailEvents = [];
            try {
              assertToolAllowed(ctx, def.name);
              deps.rateLimiter?.charge(ctx.principal);

              // Pre-guardrails — can short-circuit with deny / approve_required.
              if (deps.guardrails) {
                const pre = await deps.guardrails.runPre(ctx, def.name, args);
                guardrailEvents.push(...pre.events);
                if (pre.result.action !== "allow") {
                  deps.audit?.write({
                    ctx,
                    tool: def.name,
                    durationMs: Date.now() - startedAt,
                    error: pre.result.reason || pre.result.action,
                    guardrailEvents,
                  });
                  return {
                    isError: true,
                    content: [
                      {
                        type: "text",
                        text:
                          pre.result.action === "approve_required"
                            ? `Approval required: ${pre.result.reason || "this call requires human approval before proceeding."}`
                            : `Denied: ${pre.result.reason || "guardrail policy"}`,
                      },
                    ],
                  };
                }
              }

              let result = await def.handler(args, ctx, deps);

              const maxCells = deps.provider?.getSafetyConfig?.()?.maxResultCells ?? 0;
              result = applyResultCap(result, maxCells);

              // Post-guardrails — transform the result (mask PII, redact, etc.).
              if (deps.guardrails) {
                const post = await deps.guardrails.runPost(ctx, def.name, args, result);
                guardrailEvents.push(...post.events);
                result = post.result;
              }

              deps.audit?.write({
                ctx,
                tool: def.name,
                rowCount:
                  result?.rows?.length ?? result?.hits?.length ?? result?.values?.length,
                durationMs: Date.now() - startedAt,
                truncated: result?.truncated || undefined,
                guardrailEvents: guardrailEvents.length ? guardrailEvents : undefined,
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
                guardrailEvents: guardrailEvents.length ? guardrailEvents : undefined,
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
