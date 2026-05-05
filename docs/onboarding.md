# Customer onboarding — 30 minutes from zero to "Claude is querying my warehouse"

This is the written version of the live screen-share recipe. Hand it to a customer and they should be able to follow it without us on the call.

## What you need before starting

- One of: Postgres, Oracle, Redshift, Snowflake, BigQuery, or DuckDB
- Read-only credentials for that warehouse (we'll show you the recommended grants below)
- Either Docker installed, OR Node 20+
- Claude Desktop (or Cursor) installed on the laptop where you'll be asking questions

That's it.

---

## Step 1 — install (pick one)

### Option A: Docker (recommended for production)

```bash
docker run -d --name warehouse-mcp \
  -p 3001:3001 \
  -e WAREHOUSE_TYPE=postgres \
  -e PG_HOST=db.your-private-dns \
  -e PG_DATABASE=analytics \
  -e PG_USER=mcp_reader \
  -e PG_PASSWORD='your-password-here' \
  -e MCP_API_KEYS="$(openssl rand -hex 24):reader" \
  -v /opt/warehouse-mcp/audit:/app/audit \
  --restart unless-stopped \
  ghcr.io/kalehdoo/warehouse-mcp:latest
```

The `MCP_API_KEYS` line generates a fresh bearer key and prints it to your shell. **Save it now** — you'll paste it into Claude Desktop in step 3.

For other warehouses (Oracle, Snowflake, BigQuery, etc.), the env-var set differs. See the per-warehouse docs:

- [Postgres](adapters/postgres.md) — most common
- [Oracle](adapters/oracle.md) — Thin mode, no Instant Client needed
- [Redshift](adapters/redshift.md) — same shape as Postgres
- [Snowflake](adapters/snowflake.md) — key-pair auth required
- [BigQuery](adapters/bigquery.md) — service-account JSON

### Option B: npx (recommended for local development)

```bash
npx warehouse-mcp@latest init
```

The wizard walks through the same questions interactively, writes a `.env` (mode 0600), and prints a Claude Desktop snippet at the end. Then:

```bash
npx warehouse-mcp doctor    # ✓✓✓✓ — confirms your config + connection
npx warehouse-mcp start     # binds to localhost:3001
```

### Option C: docker-compose demo (no warehouse credentials needed)

Want to evaluate without any warehouse setup? Clone the repo and run:

```bash
git clone https://github.com/kalehdoo/warehouse-mcp.git
cd warehouse-mcp
docker compose up
```

This boots a Postgres pre-seeded with a small ecommerce dataset (10 customers, 10 products, 30 orders) plus the MCP server pointing at it. Bearer key is `demo-key-change-me` (rotate it before doing anything serious).

---

## Step 2 — verify

Whatever install path you took, confirm the server is alive:

```bash
curl http://localhost:3001/health
# → {"status":"ok","server":"warehouse-mcp","version":"0.1.0","warehouse":"postgres",...}
```

If you used the npx path, also run the doctor:

```bash
npx warehouse-mcp doctor
```

You should see all green checks. If anything is red, fix it before continuing — see [troubleshooting.md](troubleshooting.md) for the common cases.

---

## Step 3 — wire Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows). Create the file if it doesn't exist.

Add this entry (merge with any existing `mcpServers` block):

```json
{
  "mcpServers": {
    "warehouse-mcp": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR-API-KEY-FROM-STEP-1"
      }
    }
  }
}
```

Restart Claude Desktop. Open the MCP servers panel — you should see "warehouse-mcp" connected with eight tools.

For Cursor, use [docs/install-cursor.md](install-cursor.md). The format is essentially identical.

---

## Step 4 — ask the three questions

These three questions exercise the full surface and prove the install worked. Ask them in order in Claude Desktop:

1. **"What schemas and tables does my warehouse have?"**
   — Exercises `list_schemas` + `list_tables`. You should see your warehouse layout summarized in plain English.

2. **"Show me the first 5 rows of [pick a table from #1]."**
   — Exercises `sample_table`. Confirms the read-only path works end-to-end.

3. **"What are my top 10 customers by [revenue / order count / signup recency / pick one]?"**
   — Exercises `query` with a real analytical SELECT. Replace the metric with whatever your domain uses.

If all three work, you're done. Claude can now answer ad-hoc questions against your warehouse.

---

## What to tell your team

Once it's running, share three things internally:

1. **The bearer key** (via your password manager, not Slack). Anyone with the key can issue queries through the same audit identity.
2. **Where the audit log lives.** Default `/app/audit/audit-YYYY-MM-DD.jsonl` inside the container, mounted to your host volume. Tail it during a session to see what Claude is actually running.
3. **The cost guardrails.** warehouse-mcp does not have built-in cost protection. Pair it with your warehouse's resource monitors (Snowflake credits, BigQuery quotas, Redshift WLM queues) before pointing real money at it.

---

## What to expect

**Performance.** Claude will sometimes issue 3–5 small probing queries to figure out the schema before answering a single human question. That's normal — exploration tax. Total latency is usually 2–10 seconds per question.

**Accuracy.** Claude is good at translating English to SQL but it's not perfect. Always sanity-check numbers it gives you for high-stakes decisions. The audit log shows you exactly what query produced any given answer.

**Read-only.** The server hard-blocks `INSERT`, `UPDATE`, `DELETE`, `DROP`, and friends — even if your warehouse role would technically allow them. v2 will add write tools behind a flag.

---

## When something goes wrong

- Run `warehouse-mcp doctor` first — it usually tells you the problem.
- Check [docs/troubleshooting.md](troubleshooting.md) for common failures.
- Read the audit log: `tail -f /app/audit/audit-$(date -u +%F).jsonl | jq`.
- File a bug via the GitHub issue template.
