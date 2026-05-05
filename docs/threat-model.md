# Threat model

A practical OWASP-mapped walkthrough of warehouse-mcp's HTTP transport. Audience: anyone deploying it next to real customer data, or reviewing it before approving production use.

This document describes what the codebase mitigates today and what it deliberately leaves to the operator. Read it before deploying.

---

## System boundary

```
[ AI client ]  ──HTTPS──►  [ reverse proxy ]  ──HTTP──►  [ warehouse-mcp ]  ──TLS──►  [ data warehouse ]
   (Claude Desktop,                              (your nginx,                      (this repo)                                    (Postgres,
    Cursor, custom)                               Caddy, ALB)                                                                      Snowflake,
                                                                                                                                  Oracle, …)
```

Trust boundaries:
1. **Client ↔ reverse proxy.** TLS terminated here. Client identity is a bearer token (static API key or JWT).
2. **Proxy ↔ MCP server.** Plain HTTP. Same host or private VPC.
3. **MCP server ↔ warehouse.** TLS to managed warehouses, plain to in-VPC ones (your call).

The MCP server is *not* internet-exposed by design. The reverse proxy is what your firewall and WAF policies should target.

---

## OWASP Top 10 mapping

### A01 — Broken Access Control

| Risk | Mitigation |
|---|---|
| API key shared between roles | `MCP_API_KEYS=key1:reader,key2:admin` — each key carries a role; `assertToolAllowed` rejects out-of-role tool calls in `src/security/policy.js`. |
| Tenant data crossing | `Context.tenantId` flows through every adapter call. Adapter pool is keyed by tenant. v1 self-hosted has one tenant; the SaaS variant inherits the same plumbing. |
| Stdio bypassing auth | Stdio mode synthesizes an `admin` context because the OS process boundary *is* the trust boundary. If you don't trust the local user, don't run stdio mode. |

### A02 — Cryptographic Failures

| Risk | Mitigation |
|---|---|
| Plaintext credentials over the wire | TLS terminated at the reverse proxy. **The MCP server speaks plain HTTP intentionally** — TLS is the proxy's job, not ours. Don't expose port 3001 to the internet. |
| Secrets in git | `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`. `.env.example` ships placeholder values only. |
| Secrets in logs | `WarehouseError` wraps driver errors with a static prefix; the original `cause` is attached for debugging but not stringified into the message. Audit log clips long fields. |

### A03 — Injection

| Risk | Mitigation |
|---|---|
| SQL injection via `query` tool | `normalizeReadOnlySql` (`src/security/sqlValidator.js`) rejects multi-statement, write keywords, recursive CTEs, oversized LIMITs. Dialect-aware so Oracle's `FETCH FIRST` quirk is enforced. **23 unit tests cover the validator boundary.** |
| Catalog SQL composed from user input | `list_tables`, `describe_table`, `top_values`, `column_stats` use `pg.Pool.query(sql, params)` parameterized binding for Postgres/Redshift. Oracle uses `:owner`/`:tbl` named binds. Snowflake uses `?` positional binds. BigQuery's `client.dataset(name)` API does the escaping. |
| `search_value` literal injection | `quoteLiteral` in `src/util/sqlDialect.js` doubles single quotes and rejects NUL bytes; identifiers go through `quoteIdent`. |
| Log injection via JSON | Audit log uses `JSON.stringify` (escapes control chars). Per-field byte clip prevents disk fill from oversized SQL or driver error blobs. |

### A04 — Insecure Design

| Risk | Mitigation |
|---|---|
| Default-allow auth | Auth is "off by default" *only* when neither `MCP_API_KEYS` nor `MCP_OIDC_ISSUER` is set. The `init` wizard asks about auth and warns when generating a key. The `doctor` command reports `disabled (dev mode)` when no auth is configured — visible signal to the operator. |
| Write surface creep | v1 ships **read-only tools only**. Future write tools land behind `ENABLE_WRITE_TOOLS`. `assertReadOnly` is a defense-in-depth check at the adapter boundary even though the validator should already have rejected writes. |

### A05 — Security Misconfiguration

| Risk | Mitigation |
|---|---|
| CORS wildcard | `MCP_ALLOWED_ORIGINS` is an explicit allowlist; wildcards not supported. The HTTP transport reflects the request origin only if it's in the allowlist (`src/transport/http.js:applyCors`). |
| Container as root | Dockerfile creates `mcp:10001` and `USER mcp` before any code runs. Healthcheck and CMD both run unprivileged. |
| Read-only fs | `docs/deploy-kubernetes.md` example sets `readOnlyRootFilesystem: true` with an emptyDir for `/tmp` and a volume for `/app/audit`. |

### A06 — Vulnerable and Outdated Components

| Risk | Mitigation |
|---|---|
| Transitive CVEs in driver chain | `npm audit` in CI; current known: 21 transitive vulns from `snowflake-sdk`'s old AWS SDK. Tracked separately, not auto-fixed (risk of breaking known-good driver behavior). Dependabot recommended on the repo. |
| Supply chain | Release images signed with cosign keyless via Sigstore. SBOM (CycloneDX) attached to every GitHub Release. See `cosign verify` recipe in `docs/deploy-docker.md`. |

### A07 — Identification and Authentication Failures

| Risk | Mitigation |
|---|---|
| Bearer key stuffing / brute force | Token-bucket rate limiter per principal (`src/security/rateLimit.js`). Configure with `MCP_RATE_LIMIT_RPM`. Off by default; recommend 60 (1 req/sec) for production. |
| JWT alg confusion | `verifyJwt` uses `jose` with the issuer's JWKS; we never accept caller-specified algorithms. |
| Predictable session ids | `StreamableHTTPServerTransport` session ids combine `Date.now()` (base36) + 64 bits of `Math.random()`. Not crypto-grade — paired with bearer auth, that's acceptable for v1. Upgrade to `crypto.randomUUID()` if a customer requires it. |

### A08 — Software and Data Integrity Failures

| Risk | Mitigation |
|---|---|
| Tampered image | Cosign keyless signing in `release.yml`. Verify before deploying:<br>`cosign verify ghcr.io/.../warehouse-mcp:0.1.0 --certificate-identity-regexp ... --certificate-oidc-issuer https://token.actions.githubusercontent.com` |
| Unknown dependencies in image | CycloneDX SBOM published with each release. |
| Result tampering | Tool results are JSON-serialized server-side. The client trusts what the bearer-authed server says. |

### A09 — Security Logging and Monitoring Failures

| Risk | Mitigation |
|---|---|
| No audit trail | Every tool call writes a JSONL record with `tenant_id`, `principal`, `role`, `request_id`, `tool`, `sql`, `row_count`, `duration_ms`, `error`, `truncated`. Rotated daily. |
| Audit DoS | Per-field byte clip (`AUDIT_FIELD_MAX_BYTES`, default 4 KB). |
| No metrics/traces | Optional OpenTelemetry: set `OTEL_EXPORTER_OTLP_ENDPOINT` and per-tool spans flow to your collector. |

### A10 — Server-Side Request Forgery

| Risk | Mitigation |
|---|---|
| Tool tricked into hitting an internal endpoint | The MCP server only talks to the **one configured warehouse**. There is no tool that takes a URL parameter or follows links. JWT verification in `src/auth/jwt.js` is the only outbound HTTP and it goes to the configured OIDC issuer. |

---

## What is *not* in scope

These are real concerns; they live at the deployment layer, not in this codebase.

- **DDoS / volumetric attacks.** Use a WAF or CDN.
- **TLS termination.** Use a reverse proxy.
- **Network-level isolation.** Run the container in the same VPC as the warehouse, restrict egress with security groups or NetworkPolicies.
- **Secrets management.** We read env vars; store them in your secrets manager (AWS Secrets Manager, GCP Secret Manager, k8s Secret + sealed-secrets, etc.) and mount them into the env at deploy.
- **Backup of the audit log.** Mount `/app/audit` to durable storage or stream to your SIEM.
- **Cost guardrails on the warehouse.** Pair with Snowflake resource monitors, BigQuery quotas, Redshift WLM queues.
- **Pen test.** Recommended before GA. The current code has not been externally tested.

---

## Reporting a vulnerability

Open a GitHub Security Advisory on the repo, or email the maintainers privately. **Do not file a public issue for security bugs.** Coordinated disclosure preferred.

---

## Threat model history

| Date | Author | Notes |
|---|---|---|
| 2026-05-05 | initial | Phase 7 hardening pass: rate limit, query timeout, result cap, audit clipping. Threat model first published. |
