#!/usr/bin/env node

const args = process.argv.slice(2);
const cmd = args[0];

const help = `warehouse-mcp — Drop-in MCP server for your data warehouse

Usage:
  warehouse-mcp <command>

Commands:
  init      Interactive setup (lands in Phase 5)
  start     Run the MCP server (lands in Phase 2)
  doctor    Diagnose configuration (lands in Phase 5)
  --help    Show this help

This is the v0.1.0 scaffold. Subcommands ship in later phases.`;

if (!cmd || cmd === "--help" || cmd === "-h") {
  console.log(help);
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
console.error("Run 'warehouse-mcp --help' for usage.");
process.exit(1);
