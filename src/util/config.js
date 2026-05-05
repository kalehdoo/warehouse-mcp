import "dotenv/config";
import { z } from "zod";

const TransportSchema = z.enum(["http", "stdio"]).default("http");
const WarehouseTypeSchema = z.enum([
  "postgres",
  "oracle",
  "redshift",
  "snowflake",
  "bigquery",
  "duckdb",
]);

const BaseEnvSchema = z.object({
  MCP_TRANSPORT: TransportSchema,
  MCP_SERVER_PORT: z.coerce.number().int().positive().default(3001),
  MCP_SERVER_HOST: z.string().default("0.0.0.0"),
  MCP_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  MCP_API_KEYS: z.string().default(""),
  MCP_OIDC_ISSUER: z.string().default(""),
  MCP_OIDC_AUDIENCE: z.string().default(""),
  TENANT_ID: z.string().default("default"),
  WAREHOUSE_TYPE: WarehouseTypeSchema.optional(),
  QUERY_DEFAULT_LIMIT: z.coerce.number().int().positive().default(1000),
  QUERY_HARD_MAX_LIMIT: z.coerce.number().int().positive().default(10000),
  QUERY_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  // Result-cap and rate-limit additions for hardening (Phase 7).
  // 0 disables either limit. Defaults are picked to be cautious but not
  // surprising for typical analytical queries.
  QUERY_MAX_RESULT_CELLS: z.coerce.number().int().nonnegative().default(100_000),
  MCP_RATE_LIMIT_RPM: z.coerce.number().int().nonnegative().default(0),
  AUDIT_DIR: z.string().default("./audit"),
  AUDIT_ROTATION: z.enum(["daily", "off"]).default("daily"),
  AUDIT_FIELD_MAX_BYTES: z.coerce.number().int().positive().default(4096),
});

function parseApiKeys(raw) {
  const map = new Map();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed.includes(":")) continue;
    const idx = trimmed.indexOf(":");
    const token = trimmed.slice(0, idx);
    const role = trimmed.slice(idx + 1);
    if (token && role) map.set(token, role);
  }
  return map;
}

function buildWarehouseConfig(env) {
  const type = env.WAREHOUSE_TYPE;
  if (!type) return null;
  switch (type) {
    case "postgres":
      return {
        type,
        host: process.env.PG_HOST,
        port: Number(process.env.PG_PORT || 5432),
        database: process.env.PG_DATABASE,
        user: process.env.PG_USER,
        password: process.env.PG_PASSWORD,
        ssl: (process.env.PG_SSL || "true").toLowerCase() !== "false",
      };
    case "redshift":
      return {
        type,
        host: process.env.REDSHIFT_HOST,
        port: Number(process.env.REDSHIFT_PORT || 5439),
        database: process.env.REDSHIFT_DATABASE,
        user: process.env.REDSHIFT_USER,
        password: process.env.REDSHIFT_PASSWORD,
        ssl: (process.env.REDSHIFT_SSL || "true").toLowerCase() !== "false",
      };
    case "oracle":
      return {
        type,
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING,
        walletLocation: process.env.ORACLE_WALLET_LOCATION || undefined,
        walletPassword: process.env.ORACLE_WALLET_PASSWORD || undefined,
      };
    case "snowflake":
      return {
        type,
        account: process.env.SNOWFLAKE_ACCOUNT,
        username: process.env.SNOWFLAKE_USER,
        privateKeyPath: process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE,
        database: process.env.SNOWFLAKE_DATABASE,
        schema: process.env.SNOWFLAKE_SCHEMA,
        role: process.env.SNOWFLAKE_ROLE,
      };
    case "bigquery":
      return {
        type,
        projectId: process.env.BIGQUERY_PROJECT,
        location: process.env.BIGQUERY_LOCATION || "US",
        keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || undefined,
      };
    case "duckdb":
      // MOTHERDUCK_TOKEN is optional. When set, the DuckDB driver will use
      // it to authenticate against MotherDuck-hosted databases (paths like
      // "md:my_db"). Local file or in-memory paths ignore the token.
      return {
        type,
        path: process.env.DUCKDB_PATH || ":memory:",
        motherduckToken: process.env.MOTHERDUCK_TOKEN || undefined,
      };
    default:
      return null;
  }
}

export function loadConfig(env = process.env) {
  const parsed = BaseEnvSchema.parse(env);
  return {
    transport: parsed.MCP_TRANSPORT,
    server: {
      port: parsed.MCP_SERVER_PORT,
      host: parsed.MCP_SERVER_HOST,
      allowedOrigins: parsed.MCP_ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    },
    auth: {
      apiKeys: parseApiKeys(parsed.MCP_API_KEYS),
      oidc:
        parsed.MCP_OIDC_ISSUER && parsed.MCP_OIDC_AUDIENCE
          ? { issuer: parsed.MCP_OIDC_ISSUER, audience: parsed.MCP_OIDC_AUDIENCE }
          : null,
    },
    tenant: {
      defaultTenantId: parsed.TENANT_ID,
    },
    safety: {
      defaultLimit: parsed.QUERY_DEFAULT_LIMIT,
      hardMaxLimit: parsed.QUERY_HARD_MAX_LIMIT,
      timeoutMs: parsed.QUERY_TIMEOUT_MS,
      maxResultCells: parsed.QUERY_MAX_RESULT_CELLS,
      rateLimitRpm: parsed.MCP_RATE_LIMIT_RPM,
      auditFieldMaxBytes: parsed.AUDIT_FIELD_MAX_BYTES,
    },
    audit: {
      dir: parsed.AUDIT_DIR,
      rotation: parsed.AUDIT_ROTATION,
    },
    warehouse: buildWarehouseConfig(parsed),
  };
}

/**
 * ConfigProvider — abstraction so SaaS can swap env-based config for a tenant-aware store
 * without touching call sites. v1 self-hosted: one tenant, env-backed.
 */
export class EnvConfigProvider {
  constructor(config) {
    this.config = config;
  }
  getWarehouseConfig(tenantId) {
    if (tenantId !== this.config.tenant.defaultTenantId) {
      throw new Error(
        `Unknown tenant: ${tenantId}. Self-hosted v1 supports only TENANT_ID=${this.config.tenant.defaultTenantId}.`,
      );
    }
    if (!this.config.warehouse) {
      throw new Error("WAREHOUSE_TYPE is not configured. Set it in .env.");
    }
    // Merge per-process safety knobs so adapters can pass them straight to
    // their drivers (statement_timeout, callTimeout, jobTimeoutMs, etc.).
    return { ...this.config.warehouse, timeoutMs: this.config.safety.timeoutMs };
  }
  getApiKeys() {
    return this.config.auth.apiKeys;
  }
  getOidcConfig() {
    return this.config.auth.oidc;
  }
  getSafetyConfig() {
    return this.config.safety;
  }
}
