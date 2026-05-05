/**
 * Redshift adapter.
 *
 * Redshift is wire-compatible with Postgres, so we reuse the Postgres adapter
 * with `type: "redshift"` for diagnostics and audit logs. Catalog views
 * (information_schema, pg_catalog) are present in Redshift, so the same
 * metadata SQL works for the v1 read-only surface.
 *
 * Phase 3+ note: if customers need Redshift-specific catalog (`SVV_*` views,
 * external schemas via Redshift Spectrum, late-binding views), we'll add
 * Redshift-only overrides here rather than polluting the Postgres adapter.
 */
import { createPostgresAdapter } from "./postgres.js";

export function createRedshiftAdapter(config) {
  return createPostgresAdapter(config, { type: "redshift" });
}
