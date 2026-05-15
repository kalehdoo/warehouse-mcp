import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_FIELD_MAX_BYTES = 4096;

/**
 * Clip a string field to a byte budget. JSON.stringify already escapes control
 * characters (no log-injection risk via newlines), but unbounded SQL or error
 * messages would blow up the audit log size — and a hostile prompt could try
 * to fill disks via tool errors. Clipping is the cheap defense.
 */
function clipString(value, maxBytes) {
  if (value == null) return value;
  const s = String(value);
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  let out = s.slice(0, maxBytes);
  while (Buffer.byteLength(out, "utf8") > maxBytes - 16) {
    out = out.slice(0, -16);
  }
  return out + "…[clipped]";
}

/**
 * Append-only JSONL audit sink. One file per UTC day when rotation=daily.
 * Writes synchronously via appendFileSync — audit volume is one record per
 * tool call (not on the hot data path), so the cost is negligible and we
 * avoid an entire class of buffer/close races.
 */
export class JsonlAuditSink {
  constructor({ dir, rotation = "daily", fieldMaxBytes = DEFAULT_FIELD_MAX_BYTES }) {
    this.dir = dir;
    this.rotation = rotation;
    this.fieldMaxBytes = fieldMaxBytes;
    this._dirEnsured = false;
  }

  _path() {
    if (this.rotation === "off") {
      return join(this.dir, "audit.jsonl");
    }
    const today = new Date().toISOString().slice(0, 10);
    return join(this.dir, `audit-${today}.jsonl`);
  }

  _ensureDir() {
    if (!this._dirEnsured) {
      mkdirSync(this.dir, { recursive: true });
      this._dirEnsured = true;
    }
  }

  /**
   * @param {{ctx: import("../auth/context.js").Context, tool: string, args?: object, sql?: string, rowCount?: number, durationMs?: number, error?: string, truncated?: boolean, guardrailEvents?: import("../guardrails/types.js").GuardrailEvent[]}} entry
   */
  write(entry) {
    const max = this.fieldMaxBytes;
    const record = {
      ts: new Date().toISOString(),
      tenant_id: entry.ctx.tenantId,
      principal: entry.ctx.principal,
      role: entry.ctx.role,
      warehouse_role: entry.ctx.warehouseRole,
      // Whether this session was granted the warehouse://semantic/* resources.
      // Helps explain after-the-fact why one principal's queries are more or
      // less precise than another's running on the same tools.
      include_semantic: entry.ctx.includeSemantic,
      request_id: entry.ctx.requestId,
      tool: entry.tool,
      sql: clipString(entry.sql, max),
      row_count: entry.rowCount,
      duration_ms: entry.durationMs,
      truncated: entry.truncated,
      error: clipString(entry.error, max),
      guardrail_events: entry.guardrailEvents,
    };
    try {
      this._ensureDir();
      appendFileSync(this._path(), JSON.stringify(record) + "\n");
    } catch {
      // never let audit failures break a tool call
    }
  }

  close() {
    // No-op for the sync sink — preserved for API compatibility with the
    // shutdown handler in src/index.js.
  }
}
