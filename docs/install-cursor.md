# Installing warehouse-mcp in Cursor

Cursor reads `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in the workspace (per-project). The file format mirrors Claude Desktop's.

## Project-scoped (recommended for warehouses)

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "warehouse-mcp": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer <api-key-from-init>"
      }
    }
  }
}
```

Then run the server in a terminal: `warehouse-mcp start`.

Reload Cursor (Cmd-Shift-P → "Developer: Reload Window") and the server appears in the MCP panel.

## Global (stdio mode)

For a single warehouse you want available everywhere, use stdio mode in `~/.cursor/mcp.json`:

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

Cursor will spawn the server when needed. Make sure your `.env` is reachable from the working directory Cursor uses (usually your home).

## Notes

Same behavior as Claude Desktop: read-only, audit-logged, eight tools. See [install-claude-desktop.md](install-claude-desktop.md) for verification commands and operational notes.
