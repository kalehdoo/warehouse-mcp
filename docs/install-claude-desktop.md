# Installing warehouse-mcp in Claude Desktop

Two ways. Pick the one that matches your situation.

| Mode | Use when | Pros | Cons |
|---|---|---|---|
| **stdio** | You only need access from your laptop | Zero network exposure, simplest config | One Claude Desktop = one running server |
| **HTTP** | You want to share the server with a team, or run it inside your VPC | Multiple clients, shared audit log, real auth | Requires deploying the server somewhere reachable |

## Quickest start (stdio, local-only)

This launches the server inside Claude Desktop on demand — no separate process to manage.

1. Run the wizard once to get a `.env`:
   ```bash
   npx warehouse-mcp@latest init
   ```
2. Open `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%/Claude/claude_desktop_config.json` (Windows). Create the file if it doesn't exist.
3. Add this entry (merge with any existing `mcpServers` block):
   ```json
   {
     "mcpServers": {
       "warehouse-mcp": {
         "command": "npx",
         "args": ["-y", "warehouse-mcp@latest", "start"],
         "env": { "MCP_TRANSPORT": "stdio" }
       }
     }
   }
   ```
4. Restart Claude Desktop. The MCP icon should show "warehouse-mcp" in the connected servers list.

Test with: *"List the schemas in my warehouse, then show me the first 5 rows of any table you find."*

## HTTP mode (deployed server, multi-user)

Use this when the server runs as a long-lived process (Docker container, k8s pod, systemd service) and Claude Desktop connects to it over the network.

1. On the host, configure and run:
   ```bash
   warehouse-mcp init     # generates a bearer key during setup
   warehouse-mcp start    # binds to MCP_SERVER_PORT (default 3001)
   ```
2. In `claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "warehouse-mcp": {
         "url": "http://your-server:3001/mcp",
         "headers": {
           "Authorization": "Bearer <api-key-from-init>"
         }
       }
     }
   }
   ```
3. Restart Claude Desktop.

For production, terminate TLS at a reverse proxy (nginx, Caddy, Cloudflare) in front of the server. The MCP server itself speaks plain HTTP intentionally — TLS is the proxy's job.

## Verifying

Inside Claude Desktop, ask: *"What tools does warehouse-mcp expose?"*

You should see the eight v1 tools: `query`, `list_schemas`, `list_tables`, `describe_table`, `sample_table`, `column_stats`, `top_values`, `search_value`.

If something looks wrong, run `warehouse-mcp doctor` from the same shell — it diagnoses configuration and connection issues without booting the full server.

## Notes

- **Read-only.** v1 only exposes read tools. The SQL validator rejects `INSERT`, `DELETE`, `DROP`, etc., even if the warehouse role technically allows them.
- **Audit log.** Every tool call is appended to `./audit/audit-YYYY-MM-DD.jsonl` (or wherever `AUDIT_DIR` points). Tail it during a session to see what Claude is actually running.
- **Cost.** The server has no per-query cost guardrails. Pair it with your warehouse's resource monitors (Snowflake credit limits, BigQuery quotas, Redshift WLM queues) before pointing real money at it.
