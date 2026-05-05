import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, META } from "../server.js";
import { authenticate } from "../auth/bearer.js";
import { logger } from "../util/logger.js";

function applyCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
}

/**
 * Boot the Streamable HTTP transport.
 *
 * Wire format mirrors the existing ai-data-analyst/mcp-server pattern:
 *  - One transport instance per session.
 *  - Sessions stored in-memory keyed by mcp-session-id header.
 *  - A fresh McpServer is built per session, bound to the auth Context, so
 *    role/tenant/principal flow through every tool invocation without globals.
 *
 * @param {{config: object, provider: object, audit?: object, rateLimiter?: object}} deps
 */
export function startHttpTransport({ config, provider, audit, rateLimiter }) {
  /** @type {Map<string, {transport: StreamableHTTPServerTransport, ctx: object}>} */
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    applyCors(req, res, config.server.allowedOrigins);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          server: META.name,
          version: META.version,
          warehouse: config.warehouse?.type || "unconfigured",
          sessions: sessions.size,
        }),
      );
      return;
    }

    if (req.url !== "/mcp") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const auth = await authenticate(req, provider);
    if (!auth.ok) {
      res.writeHead(auth.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: auth.error }));
      logger.warn("auth rejected", { error: auth.error });
      return;
    }

    const existingSessionId = req.headers["mcp-session-id"];
    if (existingSessionId && sessions.has(existingSessionId)) {
      const { transport } = sessions.get(existingSessionId);
      await transport.handleRequest(req, res);
      return;
    }

    const ctx = auth.ctx;
    const mcpServer = buildServer(ctx, { provider, audit, rateLimiter });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () =>
        `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { transport, ctx });
        logger.info("session started", { sessionId, tenant: ctx.tenantId, role: ctx.role });
      },
    });
    transport.onclose = () => {
      for (const [id, entry] of sessions) {
        if (entry.transport === transport) {
          sessions.delete(id);
          logger.info("session closed", { sessionId: id });
        }
      }
    };
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  server.listen(config.server.port, config.server.host, () => {
    logger.info("http transport listening", {
      url: `http://${config.server.host}:${config.server.port}/mcp`,
      health: `http://${config.server.host}:${config.server.port}/health`,
      authEnabled: provider.getApiKeys().size > 0 || Boolean(provider.getOidcConfig()),
      warehouse: config.warehouse?.type || "unconfigured",
    });
  });

  return server;
}
