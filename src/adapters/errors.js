/**
 * Common error type for every adapter. Wrapping driver errors in a single class
 * keeps the MCP layer's error handling uniform and prevents driver internals
 * (or worse, secrets in connection strings) from leaking out to the AI client.
 *
 * Codes:
 *   CONNECTION_FAILED   — couldn't reach or authenticate to the warehouse
 *   QUERY_FAILED        — the warehouse rejected the SQL we sent it
 *   CATALOG_FAILED      — schema/table/column metadata lookup failed
 *   NOT_FOUND           — the named schema, table, or column doesn't exist
 *   TIMEOUT             — query exceeded the configured timeout
 *   PERMISSION_DENIED   — the configured warehouse role lacks access
 *   UNSUPPORTED         — the requested operation isn't supported on this warehouse
 */
export class WarehouseError extends Error {
  constructor(code, message, { cause, warehouse } = {}) {
    super(message);
    this.name = "WarehouseError";
    this.code = code;
    this.warehouse = warehouse;
    if (cause) this.cause = cause;
  }
}

/**
 * Wrap an arbitrary driver error in a WarehouseError. Preserves the original
 * error as `cause` for debugging without exposing it through the message.
 *
 * @param {unknown} err
 * @param {string} fallbackCode
 * @param {string} fallbackMsg
 * @param {string} warehouse
 */
export function wrapError(err, fallbackCode, fallbackMsg, warehouse) {
  if (err instanceof WarehouseError) return err;
  const detail = err && typeof err === "object" && "message" in err ? err.message : String(err);
  return new WarehouseError(fallbackCode, `${fallbackMsg}: ${detail}`, { cause: err, warehouse });
}
