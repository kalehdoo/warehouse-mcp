/**
 * `warehouse-mcp init` — interactive setup wizard.
 *
 * Asks for warehouse + connection details + auth + port, writes a `.env`
 * file, and prints a Claude Desktop config snippet ready to paste. Exists
 * so a customer can go from "fresh checkout" to "Claude Desktop talks to
 * my warehouse" in five minutes without reading any docs.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { ask, askRequired, askYesNo, askChoice, closePrompts } from "./prompts.js";

const WAREHOUSE_CHOICES = [
  { label: "PostgreSQL", value: "postgres" },
  { label: "Oracle (Thin mode, no Instant Client)", value: "oracle" },
  { label: "Amazon Redshift", value: "redshift" },
  { label: "Snowflake (key-pair auth)", value: "snowflake" },
  { label: "Google BigQuery", value: "bigquery" },
  { label: "DuckDB (local file or in-memory)", value: "duckdb" },
];

async function collectWarehouseConfig(type) {
  switch (type) {
    case "postgres":
    case "redshift": {
      const prefix = type === "postgres" ? "PG" : "REDSHIFT";
      const defPort = type === "postgres" ? 5432 : 5439;
      return {
        [`${prefix}_HOST`]: await askRequired("Host"),
        [`${prefix}_PORT`]: await ask("Port", { defaultValue: defPort }),
        [`${prefix}_DATABASE`]: await askRequired("Database"),
        [`${prefix}_USER`]: await askRequired("User"),
        [`${prefix}_PASSWORD`]: await askRequired("Password", { hidden: true }),
        [`${prefix}_SSL`]: (await askYesNo("Use TLS?", true)) ? "true" : "false",
      };
    }
    case "oracle":
      return {
        ORACLE_USER: await askRequired("User"),
        ORACLE_PASSWORD: await askRequired("Password", { hidden: true }),
        ORACLE_CONNECT_STRING: await askRequired(
          "Connect string (e.g. host:1521/SERVICE_NAME)",
        ),
      };
    case "snowflake":
      return {
        SNOWFLAKE_ACCOUNT: await askRequired("Account (e.g. xy12345.us-east-1)"),
        SNOWFLAKE_USER: await askRequired("Username"),
        SNOWFLAKE_PRIVATE_KEY_PATH: await askRequired("Path to PKCS8 private key (.p8)"),
        SNOWFLAKE_WAREHOUSE: await askRequired("Compute warehouse"),
        SNOWFLAKE_DATABASE: await askRequired("Database"),
        SNOWFLAKE_SCHEMA: await ask("Default schema", { defaultValue: "PUBLIC" }),
        SNOWFLAKE_ROLE: await ask("Role", { defaultValue: "" }),
      };
    case "bigquery":
      return {
        GOOGLE_APPLICATION_CREDENTIALS: await askRequired(
          "Path to service-account JSON key",
        ),
        BIGQUERY_PROJECT: await askRequired("GCP project id"),
        BIGQUERY_LOCATION: await ask("Location", { defaultValue: "US" }),
      };
    case "duckdb":
      return {
        DUCKDB_PATH: await ask("Path (use :memory: for ephemeral)", {
          defaultValue: ":memory:",
        }),
      };
  }
  return {};
}

function renderEnv(values) {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";
}

function claudeDesktopSnippet({ port, apiKey }) {
  const httpHeaders = apiKey ? `\n          "Authorization": "Bearer ${apiKey}"` : "";
  const stdioBlock = `{
  "mcpServers": {
    "warehouse-mcp": {
      "command": "npx",
      "args": ["-y", "warehouse-mcp@latest", "start"],
      "env": { "MCP_TRANSPORT": "stdio" }
    }
  }
}`;
  const httpBlock = `{
  "mcpServers": {
    "warehouse-mcp": {
      "url": "http://localhost:${port}/mcp"${
        apiKey
          ? `,
      "headers": {${httpHeaders}
      }`
          : ""
      }
    }
  }
}`;
  return { stdioBlock, httpBlock };
}

export async function initCommand() {
  process.stdout.write("warehouse-mcp init\n──────────────────\n");

  const envPath = resolve(".env");
  if (existsSync(envPath)) {
    const overwrite = await askYesNo(
      `${envPath} already exists. Overwrite?`,
      false,
    );
    if (!overwrite) {
      process.stdout.write("Aborted. No files changed.\n");
      closePrompts();
      return;
    }
  }

  const choice = await askChoice("Which warehouse?", WAREHOUSE_CHOICES);
  const warehouseType = choice.value;
  process.stdout.write(`\nConnection details for ${choice.label}:\n`);
  const warehouseEnv = await collectWarehouseConfig(warehouseType);

  process.stdout.write("\nServer:\n");
  const port = await ask("MCP server port", { defaultValue: "3001" });
  const host = await ask("MCP server host", { defaultValue: "127.0.0.1" });
  const allowedOrigins = await ask("Allowed CORS origins (comma-separated)", {
    defaultValue: "http://localhost:3000",
  });

  process.stdout.write("\nAuth:\n");
  const wantAuth = await askYesNo("Generate a bearer API key?", true);
  let apiKey;
  let apiKeysEnv = "";
  if (wantAuth) {
    apiKey = randomBytes(24).toString("hex");
    const role = await askChoice("Role for the generated key:", [
      { label: "reader (read-only catalog + query)", value: "reader" },
      { label: "admin (every tool, including future write tools)", value: "admin" },
    ]);
    apiKeysEnv = `${apiKey}:${role.value}`;
    process.stdout.write(
      `  Generated key: ${apiKey}\n  Save this somewhere safe — it will not be shown again.\n`,
    );
  }

  process.stdout.write("\nAudit:\n");
  const auditDir = await ask("Audit log directory", { defaultValue: "./audit" });

  const env = {
    MCP_TRANSPORT: "http",
    MCP_SERVER_PORT: port,
    MCP_SERVER_HOST: host,
    MCP_ALLOWED_ORIGINS: allowedOrigins,
    MCP_API_KEYS: apiKeysEnv,
    TENANT_ID: "default",
    WAREHOUSE_TYPE: warehouseType,
    AUDIT_DIR: auditDir,
    ...warehouseEnv,
  };

  process.stdout.write("\n─── Preview .env ───\n");
  process.stdout.write(renderEnv(env));
  process.stdout.write("────────────────────\n");

  const confirm = await askYesNo(`Write to ${envPath}?`, true);
  if (!confirm) {
    process.stdout.write("Aborted. No files changed.\n");
    closePrompts();
    return;
  }

  writeFileSync(envPath, renderEnv(env), { mode: 0o600 });
  process.stdout.write(`\nWrote ${envPath}.\n`);

  process.stdout.write(
    "\nNext steps:\n  1. warehouse-mcp doctor       (verify the connection)\n  2. warehouse-mcp start        (boot the server)\n",
  );

  const { stdioBlock, httpBlock } = claudeDesktopSnippet({ port, apiKey });
  process.stdout.write("\n─── Claude Desktop snippet (stdio mode, embeds the server) ───\n");
  process.stdout.write(stdioBlock + "\n");
  process.stdout.write("\n─── Claude Desktop snippet (HTTP mode, after `warehouse-mcp start`) ───\n");
  process.stdout.write(httpBlock + "\n");
  process.stdout.write(
    "\nAdd one of these to ~/Library/Application Support/Claude/claude_desktop_config.json (Mac) or %APPDATA%/Claude/claude_desktop_config.json (Win), then restart Claude Desktop.\n",
  );

  closePrompts();
}
