# Deploying warehouse-mcp with Docker

The published image is `ghcr.io/kalehdoo/warehouse-mcp`. It bundles all v1 warehouse drivers (Postgres, Oracle, Redshift, Snowflake, BigQuery, DuckDB) so the same image runs against any backend.

## One-command demo

```bash
git clone https://github.com/kalehdoo/warehouse-mcp.git
cd warehouse-mcp
docker compose up
```

This boots:
- A Postgres seeded with a small ecommerce dataset (`docker/seed/`)
- The MCP server pointing at it, listening on `http://localhost:3001`

Verify:
```bash
curl http://localhost:3001/health
# → {"status":"ok","server":"warehouse-mcp","version":"0.1.0","warehouse":"postgres",...}
```

The demo uses bearer key `demo-key-change-me` (defined in `docker-compose.yml`). Use it as `Authorization: Bearer demo-key-change-me` from your AI client. Rotate it before doing anything serious.

## Production deployment

```bash
docker run -d --name warehouse-mcp \
  -p 3001:3001 \
  -e WAREHOUSE_TYPE=snowflake \
  -e SNOWFLAKE_ACCOUNT=… \
  -e SNOWFLAKE_USER=… \
  -e SNOWFLAKE_PRIVATE_KEY_PATH=/keys/snowflake_rsa.p8 \
  -e SNOWFLAKE_WAREHOUSE=COMPUTE_WH \
  -e SNOWFLAKE_DATABASE=ANALYTICS \
  -e SNOWFLAKE_ROLE=MCP_READER_ROLE \
  -e MCP_API_KEYS="$(openssl rand -hex 24):reader" \
  -v /opt/warehouse-mcp/keys:/keys:ro \
  -v /opt/warehouse-mcp/audit:/app/audit \
  --restart unless-stopped \
  ghcr.io/kalehdoo/warehouse-mcp:latest
```

Per-warehouse env-var details: see [adapter docs](adapters/).

### Recommended host posture

- **TLS at a reverse proxy.** The image speaks plain HTTP intentionally — terminate TLS at nginx, Caddy, ALB, or Cloudflare. Don't expose port 3001 directly to the internet.
- **Same VPC as the warehouse.** Customer warehouses (RDS, Snowflake VPC Service Controls, BigQuery VPC-SC) usually want clients on a private network. Run the container inside the VPC where the warehouse lives.
- **Bind only to the proxy.** `-p 127.0.0.1:3001:3001` if the proxy and the container are on the same host.
- **Read-only filesystem (optional).** `--read-only --tmpfs /tmp` works because the only write target is `/app/audit`, which mounts as a separate volume.

### Verifying the image signature

Every release tag is signed via Sigstore (cosign keyless). Verify before deploying:

```bash
cosign verify ghcr.io/kalehdoo/warehouse-mcp:0.1.0 \
  --certificate-identity-regexp 'https://github.com/kalehdoo/warehouse-mcp' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

A CycloneDX SBOM is attached to each GitHub Release.

## Image size and contents

~780 MB uncompressed (compressed registry pull is ~280 MB). The big chunks are:
- node:20-bookworm-slim base (~250 MB)
- All warehouse drivers and their transitive deps in `node_modules` (~390 MB) — Snowflake's AWS SDK chain alone is ~150 MB
- ca-certificates and other apt packages (~10 MB)

We keep one image with all drivers because per-warehouse images would mean six release pipelines and six security audits. If image size becomes a bottleneck, we'll revisit.

## Build locally

```bash
docker build -t warehouse-mcp:dev .
docker run --rm -p 3001:3001 \
  -e WAREHOUSE_TYPE=duckdb -e DUCKDB_PATH=:memory: \
  warehouse-mcp:dev
```

The Dockerfile is multi-stage: the build stage runs `npm run lint && npm test` so a broken build fails fast.
