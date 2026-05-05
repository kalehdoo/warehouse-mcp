#!/usr/bin/env node
import { runCli } from "../src/cli/router.js";

runCli(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`warehouse-mcp: ${err.message}\n`);
  process.exit(1);
});
