import { loadConfig, EnvConfigProvider } from "./util/config.js";
import { JsonlAuditSink } from "./audit/jsonlSink.js";
import { startHttpTransport } from "./transport/http.js";
import { startStdioTransport } from "./transport/stdio.js";
import { closeAllAdapters } from "./adapters/index.js";
import { logger } from "./util/logger.js";

async function main() {
  const config = loadConfig();
  const provider = new EnvConfigProvider(config);
  const audit = new JsonlAuditSink({ dir: config.audit.dir, rotation: config.audit.rotation });

  const shutdown = async (signal) => {
    logger.info("shutting down", { signal });
    audit.close();
    await closeAllAdapters();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  if (config.transport === "stdio") {
    await startStdioTransport({ config, audit });
  } else {
    startHttpTransport({ config, provider, audit });
  }
}

main().catch((err) => {
  logger.error("fatal", { error: err.message, stack: err.stack });
  process.exit(1);
});
