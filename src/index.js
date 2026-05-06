import { loadConfig, EnvConfigProvider } from "./util/config.js";
import { JsonlAuditSink } from "./audit/jsonlSink.js";
import { startHttpTransport } from "./transport/http.js";
import { startStdioTransport } from "./transport/stdio.js";
import { closeAllAdapters } from "./adapters/index.js";
import { logger } from "./util/logger.js";
import { maybeInitTracing } from "./observability/otel.js";
import { TokenBucketRateLimiter } from "./security/rateLimit.js";
import { buildGuardrailPipeline } from "./guardrails/index.js";
import { loadSemantic, summarize as summarizeSemantic } from "./semantic/index.js";

async function main() {
  await maybeInitTracing("warehouse-mcp", "0.4.0");
  const config = loadConfig();
  const provider = new EnvConfigProvider(config);
  const audit = new JsonlAuditSink({
    dir: config.audit.dir,
    rotation: config.audit.rotation,
    fieldMaxBytes: config.safety.auditFieldMaxBytes,
  });
  const rateLimiter = new TokenBucketRateLimiter(config.safety.rateLimitRpm);
  const guardrails = buildGuardrailPipeline();

  const semanticResult = loadSemantic({ dir: config.semantic.dir });
  if (semanticResult.enabled) {
    logger.info("semantic loaded", { dir: config.semantic.dir, summary: summarizeSemantic(semanticResult.index) });
  } else if (semanticResult.missingDir) {
    logger.warn("semantic dir does not exist; semantic resources disabled", { dir: semanticResult.missingDir });
  }
  const semantic = semanticResult.index;

  const shutdown = async (signal) => {
    logger.info("shutting down", { signal });
    audit.close();
    await closeAllAdapters();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (config.transport === "stdio") {
    await startStdioTransport({ config, provider, audit, rateLimiter, guardrails, semantic });
  } else {
    startHttpTransport({ config, provider, audit, rateLimiter, guardrails, semantic });
  }
}

main().catch((err) => {
  logger.error("fatal", { error: err.message, stack: err.stack });
  process.exit(1);
});
