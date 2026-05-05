/**
 * CLI router: maps subcommand → handler.
 * Kept tiny so it stays trivially testable.
 */
const HELP = `warehouse-mcp — Drop-in MCP server for your data warehouse

Usage:
  warehouse-mcp <command>

Commands:
  init      Interactive setup. Writes .env and prints a Claude Desktop snippet.
  start     Boot the MCP server using the current .env / process env.
  doctor    Diagnose configuration without booting the server.
  help      Show this message.

Environment:
  See .env.example or docs/adapters/* for required variables per warehouse.
`;

export async function runCli(argv) {
  const cmd = (argv[0] || "help").toLowerCase();
  switch (cmd) {
    case "init": {
      const { initCommand } = await import("./init.js");
      return initCommand();
    }
    case "start": {
      const { startCommand } = await import("./start.js");
      return startCommand();
    }
    case "doctor": {
      const { doctorCommand } = await import("./doctor.js");
      return doctorCommand();
    }
    case "help":
    case "--help":
    case "-h": {
      process.stdout.write(HELP);
      return;
    }
    default: {
      process.stderr.write(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exit(1);
    }
  }
}
