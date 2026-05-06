/**
 * `warehouse-mcp doctor` — diagnose configuration without booting the server.
 *
 * Each check is small and either ✓ or ✗. The tool exits 0 on all-green,
 * 1 on any red. Designed so it can run unattended in customer onboarding
 * scripts and produce parseable output (one line per check).
 */
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, EnvConfigProvider } from "../util/config.js";
import { getAdapter, closeAllAdapters, SUPPORTED_WAREHOUSES } from "../adapters/index.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function ok(name, detail) {
  process.stdout.write(`${GREEN}✓${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ""}\n`);
  return true;
}

function fail(name, detail) {
  process.stdout.write(`${RED}✗${RESET} ${name}${detail ? `  ${DIM}${detail}${RESET}` : ""}\n`);
  return false;
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  return major >= 20
    ? ok("Node version", `${process.versions.node}`)
    : fail("Node version", `${process.versions.node} — need >= 20`);
}

function checkConfigParses() {
  try {
    const config = loadConfig();
    return { config, ok: ok("Config parses", `transport=${config.transport}`) };
  } catch (e) {
    fail("Config parses", e.message);
    return { config: null, ok: false };
  }
}

function checkWarehouseSelected(config) {
  if (!config?.warehouse) {
    return fail(
      "Warehouse selected",
      `WAREHOUSE_TYPE is unset. Choose one of: ${SUPPORTED_WAREHOUSES.join(", ")}`,
    );
  }
  return ok("Warehouse selected", `${config.warehouse.type}`);
}

function checkWarehouseEnv(config) {
  const w = config?.warehouse;
  if (!w) return false;
  const required = {
    postgres: ["host", "database", "user"],
    redshift: ["host", "database", "user"],
    oracle: ["user", "connectString"],
    snowflake: ["account", "username", "privateKeyPath"],
    bigquery: ["projectId"],
    duckdb: ["path"],
  }[w.type] || [];
  const missing = required.filter((k) => !w[k]);
  return missing.length === 0
    ? ok(`${w.type} env vars`, `all required values set`)
    : fail(`${w.type} env vars`, `missing: ${missing.join(", ")}`);
}

async function checkConnection(config) {
  if (!config?.warehouse) return false;
  const provider = new EnvConfigProvider(config);
  try {
    const adapter = await getAdapter({ tenantId: config.tenant.defaultTenantId }, provider);
    const result = await adapter.query("SELECT 1 AS x");
    if (result.rows.length === 1) {
      return ok("Connection + SELECT 1", `${result.rows.length} row, ${result.columns.length} column`);
    }
    return fail("Connection + SELECT 1", `unexpected result: ${JSON.stringify(result)}`);
  } catch (e) {
    return fail("Connection + SELECT 1", e.message);
  } finally {
    await closeAllAdapters();
  }
}

function checkAuditWritable(config) {
  const dir = config?.audit?.dir || "./audit";
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, ".doctor-probe");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return ok("Audit dir writable", dir);
  } catch (e) {
    return fail("Audit dir writable", `${dir}: ${e.message}`);
  }
}

async function checkSemantic(config) {
  if (!config?.semantic?.dir) {
    return ok("Semantic dir", "not configured (optional — set SEMANTIC_DIR to enable)");
  }
  try {
    const { loadSemantic, summarize } = await import("../semantic/index.js");
    const result = loadSemantic({ dir: config.semantic.dir });
    if (!result.enabled && result.missingDir) {
      return fail("Semantic dir", `${result.missingDir} does not exist`);
    }
    return ok("Semantic dir loaded", summarize(result.index));
  } catch (e) {
    return fail("Semantic dir", e.message);
  }
}

function checkAuth(config) {
  const apiKeys = config?.auth?.apiKeys?.size || 0;
  const oidc = Boolean(config?.auth?.oidc);
  if (apiKeys === 0 && !oidc && config?.transport === "http") {
    return ok(
      "Auth",
      `disabled (dev mode) — set MCP_API_KEYS or OIDC env before exposing publicly`,
    );
  }
  return ok("Auth", `apiKeys=${apiKeys}, oidc=${oidc ? "yes" : "no"}`);
}

export async function doctorCommand() {
  process.stdout.write(`warehouse-mcp doctor\n${DIM}─────────────────────${RESET}\n`);
  const results = [];
  results.push(checkNodeVersion());
  const { config, ok: configOk } = checkConfigParses();
  results.push(configOk);
  if (configOk) {
    results.push(checkWarehouseSelected(config));
    if (config.warehouse) {
      results.push(checkWarehouseEnv(config));
      results.push(await checkConnection(config));
    }
    results.push(checkAuditWritable(config));
    results.push(checkAuth(config));
    results.push(await checkSemantic(config));
  }
  const allGreen = results.every(Boolean);
  process.stdout.write(`\n${allGreen ? GREEN : RED}${allGreen ? "All checks passed." : "One or more checks failed."}${RESET}\n`);
  process.exit(allGreen ? 0 : 1);
}
