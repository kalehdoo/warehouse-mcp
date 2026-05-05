# syntax=docker/dockerfile:1.7
#
# Multi-stage build for warehouse-mcp.
#
# Why bookworm-slim instead of alpine: native modules (duckdb, oracledb's
# Thick mode if ever needed) ship glibc-targeted prebuilt binaries. Alpine
# uses musl, so prebuilt binaries fall back to compiling from source — slow
# and fragile. Bookworm-slim is ~30 MB heavier but boringly reliable.

# ---- Build stage: full dev install + lint + tests ---------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Build tools just in case any native module needs to compile from source.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run lint && npm test

# ---- Runtime stage: prod-only deps, non-root, healthcheck -------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_SERVER_HOST=0.0.0.0 \
    MCP_SERVER_PORT=3001 \
    AUDIT_DIR=/app/audit

# ca-certificates: TLS to managed warehouses (RDS, BigQuery, etc.)
# useradd in the same layer so the mcp user owns /app from the very first
# write — avoids a 389 MB chown layer that doubles node_modules on disk.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --create-home --shell /bin/bash mcp \
 && mkdir -p /app/audit \
 && chown -R mcp:mcp /app

USER mcp

COPY --chown=mcp:mcp package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Source only — no tests, no docs, no .env files.
COPY --chown=mcp:mcp src ./src
COPY --chown=mcp:mcp bin ./bin

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.MCP_SERVER_PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
