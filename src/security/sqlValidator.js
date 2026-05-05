/**
 * Read-only SQL validator with per-warehouse dialect awareness.
 *
 * Ported from ai-data-analyst/mcp-server/src/security.js, generalized to handle
 * Oracle's `FETCH FIRST n ROWS ONLY` (it has no LIMIT) and Snowflake/BigQuery
 * statement quirks. The validator is the safety boundary — any change here is
 * load-bearing for the whole product.
 */

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE",
  "MERGE", "COPY", "ATTACH", "DETACH", "EXPORT", "CALL", "VACUUM",
  "GRANT", "REVOKE", "REPLACE",
];

const ALLOWED_PREFIXES = ["SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "PRAGMA"];

/** @typedef {"postgres"|"oracle"|"redshift"|"snowflake"|"bigquery"|"duckdb"} Dialect */

export function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, "")
    .trim();
}

/**
 * Detect an existing row-cap clause in any supported dialect.
 * @param {string} upper SQL already upper-cased
 * @returns {{ type: "limit"|"fetch", value: number } | null}
 */
function detectRowCap(upper) {
  const limitMatch = upper.match(/\bLIMIT\s+(\d+)\b/);
  if (limitMatch) return { type: "limit", value: Number(limitMatch[1]) };
  const fetchMatch = upper.match(/\bFETCH\s+(?:FIRST|NEXT)\s+(\d+)\s+ROWS?\s+(?:ONLY|WITH\s+TIES)\b/);
  if (fetchMatch) return { type: "fetch", value: Number(fetchMatch[1]) };
  return null;
}

/**
 * Wrap a query to apply a default row cap, using the right syntax for the dialect.
 * @param {string} sql
 * @param {number} limit
 * @param {Dialect} dialect
 */
function applyRowCap(sql, limit, dialect) {
  if (dialect === "oracle") {
    return `SELECT * FROM (${sql}) FETCH FIRST ${limit} ROWS ONLY`;
  }
  // Postgres, Redshift, Snowflake, BigQuery, DuckDB all support LIMIT.
  return `SELECT * FROM (${sql}) LIMIT ${limit}`;
}

/**
 * Normalize a SQL statement to enforce read-only access.
 * - Strips comments
 * - Rejects multiple statements
 * - Rejects write/schema-changing operations
 * - Rejects recursive CTEs
 * - Caps UNION count
 * - Enforces a row cap (LIMIT or FETCH FIRST depending on dialect)
 *
 * @param {string} sql Raw SQL
 * @param {object} options
 * @param {Dialect} options.dialect Target warehouse dialect.
 * @param {number} [options.defaultLimit=1000] Row cap to apply if user didn't supply one.
 * @param {number} [options.maxLimit=10000] Hard ceiling on user-supplied row caps.
 * @param {number} [options.maxUnions=2] Maximum UNION clauses allowed in a single statement.
 * @returns {string} Normalized SQL ready to send to the warehouse driver.
 * @throws {Error} If the SQL violates any read-only constraint.
 */
export function normalizeReadOnlySql(
  sql,
  { dialect, defaultLimit = 1000, maxLimit = 10000, maxUnions = 2 } = {},
) {
  if (!dialect) throw new Error("normalizeReadOnlySql requires a dialect.");

  const stripped = stripSqlComments(sql);
  const statements = stripped.split(";").map((s) => s.trim()).filter(Boolean);
  if (statements.length !== 1) {
    throw new Error("Only a single SQL statement is allowed.");
  }
  const normalized = statements[0];
  const upper = normalized.toUpperCase();

  if (!ALLOWED_PREFIXES.some((p) => new RegExp(`^${p}\\b`).test(upper))) {
    throw new Error("Only read-only SQL statements are allowed.");
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${kw}\\b`).test(upper)) {
      throw new Error(`Write or schema-changing SQL is not allowed (found keyword: ${kw}).`);
    }
  }

  if (/\bWITH\s+RECURSIVE\b/.test(upper)) {
    throw new Error("Recursive CTEs are not allowed.");
  }

  const unionCount = (upper.match(/\bUNION(?:\s+ALL)?\b/g) || []).length;
  if (unionCount > maxUnions) {
    throw new Error(`Too many UNION clauses (max ${maxUnions}).`);
  }

  const cap = detectRowCap(upper);
  if (cap) {
    if (cap.value > maxLimit) {
      throw new Error(`Row cap exceeds the maximum allowed value of ${maxLimit}.`);
    }
    if (cap.type === "limit" && dialect === "oracle") {
      throw new Error(
        "Oracle does not support LIMIT. Use 'FETCH FIRST n ROWS ONLY' instead.",
      );
    }
    return normalized;
  }

  if (upper.startsWith("PRAGMA") || upper.startsWith("SHOW") || upper.startsWith("DESCRIBE") || upper.startsWith("DESC") || upper.startsWith("EXPLAIN")) {
    return normalized;
  }

  return applyRowCap(normalized, defaultLimit, dialect);
}

/**
 * Lightweight assertion that a SQL string contains no write keywords.
 * Use this when you've already done dialect-specific normalization elsewhere
 * and just want a final defensive check at the adapter boundary.
 */
export function assertReadOnly(sql) {
  const upper = sql.trim().toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    if (upper.startsWith(kw) || new RegExp(`\\b${kw}\\b`).test(upper)) {
      throw new Error(`Write operation '${kw}' is not allowed.`);
    }
  }
}

/**
 * Clip tool output text to a maximum length. Mirrors original mcp-server behavior.
 */
export function clipToolText(text, maxChars = 4500) {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}\n[Tool output clipped for safety.]`;
}
