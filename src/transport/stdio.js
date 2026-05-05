import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "../server.js";
import { makeContext } from "../auth/context.js";
import { logger } from "../util/logger.js";

/**
 * stdio transport for desktop clients (Claude Desktop, Cursor).
 *
 * Auth doesn't apply over stdio — the OS-level process boundary is the
 * trust boundary, so we synthesize an admin context from the configured tenant.
 *
 * @param {{config: object, provider: object, audit?: object}} deps
 */
export async function startStdioTransport({ config, provider, audit }) {
  const ctx = makeContext({
    tenantId: config.tenant.defaultTenantId,
    role: "admin",
    principal: "stdio-local",
  });
  const server = buildServer(ctx, { provider, audit });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("stdio transport ready", {
    tenant: ctx.tenantId,
    warehouse: config.warehouse?.type || "unconfigured",
  });
}
