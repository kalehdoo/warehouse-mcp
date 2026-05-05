# Troubleshooting

Common failures and how to fix them. If your problem isn't here, file a bug via the GitHub issue template — include `warehouse-mcp doctor` output.

---

## Server won't start

### `Error: WAREHOUSE_TYPE is not configured`

You haven't picked a warehouse. Set `WAREHOUSE_TYPE` to one of `postgres`, `oracle`, `redshift`, `snowflake`, `bigquery`, `duckdb` in your `.env` or environment.

Fastest test path:
```bash
WAREHOUSE_TYPE=duckdb DUCKDB_PATH=:memory: npm start
```

### `EADDRINUSE: port 3001 already in use`

Something else (probably another MCP server) owns port 3001. Either:
- Kill the other process: `lsof -i :3001` then `kill <pid>`
- Or run on a different port: `MCP_SERVER_PORT=37301 npm start`

For docker-compose: `MCP_HOST_PORT=37301 POSTGRES_HOST_PORT=55432 docker compose up`.

### `ZodError: Required` on boot

Config validation failed. The error names the missing field. Cross-reference with `.env.example` and your per-warehouse doc in `docs/adapters/`.

---

## Claude Desktop can't see the server

### "warehouse-mcp" doesn't appear in the MCP panel

1. Confirm the server is up: `curl http://localhost:3001/health`. Should return JSON with `"status":"ok"`.
2. Open Claude Desktop → Settings → Developer → MCP logs. Look for connection errors. Most common: malformed JSON in `claude_desktop_config.json` (a missing comma, an unescaped quote).
3. Restart Claude Desktop fully (Cmd-Q and reopen, not just close-window).

### "Tool error: Missing Authorization header"

You configured `MCP_API_KEYS` on the server but didn't add the matching `Authorization: Bearer ...` header to Claude Desktop's config. Either:
- Add the header in `claude_desktop_config.json`:
  ```json
  "headers": { "Authorization": "Bearer your-key" }
  ```
- Or run the server without auth (dev only): set `MCP_API_KEYS=` (empty) and restart.

### "Tool error: Invalid API key"

The bearer key in Claude Desktop doesn't match any entry in `MCP_API_KEYS` on the server. Regenerate one with `openssl rand -hex 24`, set it as `MCP_API_KEYS=newkey:reader`, restart the server, and update Claude Desktop's config to match.

---

## Connection to the warehouse fails

### `WarehouseError: postgres query failed: connection refused`

The server reached the network but the warehouse rejected the TCP connection. Check:
- `PG_HOST` is reachable from where the server runs. From inside a Docker container, `localhost` means the container, not the host — use `host.docker.internal` (Mac/Windows) or your host's LAN IP.
- The warehouse is actually listening on the port you configured (`PG_PORT` defaults to 5432).
- Firewall / security group allows the connection.

### `WarehouseError: postgres query failed: password authentication failed`

Credentials are wrong, or the user doesn't have `LOGIN` privilege. Re-run the recommended grants from [docs/adapters/postgres.md](adapters/postgres.md).

### `WarehouseError: oracle query failed: ORA-12541: TNS:no listener`

The Oracle host or port is wrong, or the listener isn't running. `ORACLE_CONNECT_STRING` must point at the listener, e.g. `host:1521/SERVICE_NAME`.

### `WarehouseError: snowflake query failed: 390101 (08001): Incorrect username or password`

Snowflake key-pair auth setup is incomplete:
1. Confirm `SNOWFLAKE_PRIVATE_KEY_PATH` points at a real `.p8` file readable by the process.
2. Confirm `RSA_PUBLIC_KEY` is set on the user in Snowflake. Run `DESC USER mcp_reader;` and look for the `RSA_PUBLIC_KEY` row.
3. Make sure you used the *public* key in Snowflake, not the private key.

### `WarehouseError: bigquery query failed: ... Permission denied`

Service account is missing roles. The minimum is `roles/bigquery.dataViewer` + `roles/bigquery.metadataViewer` + `roles/bigquery.jobUser`. See [docs/adapters/bigquery.md](adapters/bigquery.md).

---

## Query behavior surprises

### "Only read-only SQL statements are allowed."

You (or Claude) tried to run `INSERT`, `UPDATE`, `DELETE`, `DROP`, etc. The server is read-only by design — this isn't a misconfiguration. Write tools land in v2 behind a flag.

### "Oracle does not support LIMIT. Use 'FETCH FIRST n ROWS ONLY' instead."

The validator caught a Postgres-style `LIMIT n` aimed at an Oracle warehouse. Rewrite the query, or just remove the `LIMIT` clause and let the server auto-apply a `FETCH FIRST` based on `QUERY_DEFAULT_LIMIT`.

### "Query limit exceeds the maximum allowed value of 10000."

A `LIMIT` (or `FETCH FIRST`) larger than `QUERY_HARD_MAX_LIMIT` was requested. Either reduce the limit or raise the env var. The hard cap exists so a runaway agent doesn't try to pull a billion rows.

### Result has `truncated: true` and `original_row_count: ...`

The result exceeded `QUERY_MAX_RESULT_CELLS` (default 100k = e.g. 1000 rows × 100 cols). The server returned the first chunk and tagged the response. Either narrow the query (fewer columns, more aggressive `WHERE`) or raise `QUERY_MAX_RESULT_CELLS`.

### "Rate limit exceeded for ..."

`MCP_RATE_LIMIT_RPM` is configured and the principal exhausted its bucket. Wait `retryAfterMs`, or raise the limit.

---

## Performance

### Queries take 30+ seconds and sometimes time out

The server caps each query at `QUERY_TIMEOUT_MS` (default 30 s). Snowflake auto-resume of a suspended warehouse can eat 5–15 s of that on the first query of a session. Either:
- Raise `QUERY_TIMEOUT_MS`
- Use a warehouse that's already warm (Snowflake `ALTER WAREHOUSE ... RESUME`)
- Add an index where the query is doing a scan

### Claude makes 5+ probing queries before answering one question

Normal exploration. Claude reads schemas, samples rows, and describes tables to figure out the data model before constructing the answer. To reduce: tell it the schema name in your prompt ("In the `analytics` schema, ...") so it skips discovery.

---

## Audit log

### `Audit dir not writable: ./audit: EACCES`

The process can't create files in `AUDIT_DIR`. In Docker, this usually means a volume mount with the wrong owner. Recommended:

```bash
docker run ... -v /opt/warehouse-mcp/audit:/app/audit ...
sudo chown -R 10001:10001 /opt/warehouse-mcp/audit
```

10001 is the `mcp` user uid inside the image.

### Audit log is huge

Daily rotation is on by default but old files accumulate forever. Set up a logrotate / S3-shipping cron, or run with `AUDIT_ROTATION=off` and manage the single file yourself.

---

## OpenTelemetry not showing up

You set `OTEL_EXPORTER_OTLP_ENDPOINT` but no spans appear in your collector. Common causes:
- Endpoint is wrong. The OTLP/HTTP path is usually `http://collector:4318/v1/traces`, not just `http://collector:4318`.
- Collector is rejecting because of TLS mismatch. Use `http://...` for plain, `https://...` for TLS.
- Collector dropped the spans because of a bad pipeline config — check the collector's own logs.

The server doesn't print "tracing enabled" anywhere on boot in v0.1.0. If you set the env var and nothing breaks, it's enabled.

---

## When all else fails

```bash
warehouse-mcp doctor                       # automated diagnostics
LOG_LEVEL=debug warehouse-mcp start        # verbose logging
tail -f /app/audit/audit-*.jsonl | jq      # see what queries are running
```

Then file a bug with the doctor output and the relevant log snippet.
