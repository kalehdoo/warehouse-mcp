# Multi-role deployment

> *Last verified against v0.3.4. Pattern-based — adjust the role names to match your warehouse.*

This document is for operators standing warehouse-mcp up against an enterprise database that already has **multiple business roles** (finance, HR, payroll, etc.) and **many human users** in those roles. It explains how to map your existing role taxonomy onto MCP's four-tier role model without inventing a parallel access-control system.

If your setup is "one warehouse user, one MCP key, one team" — you don't need this guide; the standard quick-start is enough. If you have 10+ DB roles or hundreds of users, read on.

---

## The two identity layers, separated

warehouse-mcp's security has two layers that compose but are managed independently:

| Layer | What it represents | Lives where |
|---|---|---|
| **DB users** (often hundreds) | Individual humans / services | In the database. **Don't add to MCP.** |
| **DB roles** (often ~10) | Permission groupings the DB enforces (RLS, CLS, grants) | In the database. **One MCP key per role.** |
| **MCP role tier** (4 of them) | Which *tools* the AI agent can invoke | A property of each MCP key |

The relationship:
- **DB role** decides what data the database lets the query touch
- **MCP role tier** decides what kinds of operations the agent can issue in the first place

Both apply to every request. They compose: a request must pass *both* checks.

---

## When you need this guide

You need it if any of these are true:

- Your warehouse has multiple distinct DB roles (finance, hr, payroll, …) with different grants
- You want to expose some data in *aggregated form only*, not as raw rows (e.g., payroll counts by department, but never individual salaries)
- You want to give an AI agent *catalog discovery* without ever letting it read row data (compliance-heavy departments)
- You expect dozens of MCP-using identities and don't want a static-key-per-user explosion

If your situation is "one team, one warehouse, the agent can see everything," skip this guide and use the [Postgres adapter setup](adapters/postgres.md) directly.

---

## The natural pattern: `<area>` and `<area>_restricted`

If your DB role taxonomy uses a `<area>` / `<area>_restricted` pattern (one role with full read of a domain, one with locked-down access), it maps almost perfectly onto MCP's `reader` / `reader_restricted` tiers:

| DB role pattern | MCP tier | What the agent can do |
|---|---|---|
| `<area>` (full read) | `reader` | Arbitrary `SELECT`, search-by-value, plus all aggregates / catalog tools |
| `<area>_restricted` (limited) | `reader_restricted` | Aggregates / samples / time-series / catalog only — **no raw `SELECT *`, no value search** |

The MCP `reader_restricted` tier is the load-bearing piece for sensitive domains. It lets you offer aggregate analytics on payroll or HR data without giving the agent the ability to issue `SELECT * FROM payroll.salaries` — even when the underlying DB role has SELECT on those tables. RLS alone can't prevent a full-table scan; the MCP tool gate can.

For domains that should **never expose row data** (the most sensitive — `payroll_restricted`, `hr_restricted`), use the `metadata_only` tier. The agent can list schemas and tables, see column names, but never read a value.

---

## Example case study

Using a real role taxonomy from a customer deployment:

### DB-side: 8 business roles

| DB role | Grants (illustrative) |
|---|---|
| `finance` | SELECT on every finance schema |
| `finance_restricted` | SELECT on finance schemas, but RLS limits rows to current quarter |
| `payroll` | SELECT on payroll tables |
| `payroll_restricted` | SELECT on payroll summary views only, RLS by department |
| `hr` | SELECT on HR schemas |
| `hr_restricted` | SELECT on HR aggregate views only |
| `admissions` | SELECT on admissions tables, FERPA-compliant views |
| `developer` | Broad read across schemas, used by engineering for troubleshooting |

### Recommended MCP-tier mapping

| DB role | MCP tier | Reasoning |
|---|---|---|
| `finance` | `reader` | Full read of finance is the analyst use case — agent needs `query` and `search_value` |
| `finance_restricted` | `reader_restricted` | Same data domain but only aggregates — gates raw SELECT at the MCP layer |
| `payroll` | `reader_restricted` | Even "full" payroll access is sensitive; restrict to aggregates by default |
| `payroll_restricted` | `metadata_only` | Catalog only — agent knows the schema exists but never sees a row |
| `hr` | `reader_restricted` | Same logic as payroll — aggregates for analytics, no raw row access |
| `hr_restricted` | `metadata_only` | Catalog only |
| `admissions` | `reader` *or* `reader_restricted` | Depends on your privacy posture. If admissions analysts need raw rows, `reader`. If dashboards only, `reader_restricted`. |
| `developer` | `admin` | Developers troubleshoot via raw SQL across schemas; needs full tool surface |

The same DB role can map to different MCP tiers in different deployments. The mapping is a policy choice — write it down somewhere your team can review.

---

## Step-by-step setup

### 1. Generate one MCP key per DB role

```bash
for role in finance finance_restricted payroll payroll_restricted hr hr_restricted admissions developer; do
  echo "$role: $(openssl rand -hex 24)"
done > /tmp/mcp-keys.txt
chmod 600 /tmp/mcp-keys.txt
```

Save the file in your secrets manager (1Password, AWS Secrets Manager, Vault). **Each key authenticates one team** — you'll distribute the right key to the right consumers.

### 2. Build the `MCP_API_KEYS` env value

Format: `<key>:<mcp-tier>:set_role=<db-role>` per entry, comma-separated. Using the mapping table above:

```
MCP_API_KEYS=
  abc123…:reader:set_role=finance,
  def456…:reader_restricted:set_role=finance_restricted,
  ghi789…:reader_restricted:set_role=payroll,
  jkl012…:metadata_only:set_role=payroll_restricted,
  mno345…:reader_restricted:set_role=hr,
  pqr678…:metadata_only:set_role=hr_restricted,
  stu901…:reader:set_role=admissions,
  vwx234…:admin:set_role=developer
```

(In practice, the value is one long line — multi-line shown for readability.)

### 3. Grant the connection user membership in every role

The `PG_USER` (the connection identity in the pool) must be a **member** of every DB role you'll impersonate. Postgres's `SET ROLE` only allows switching to roles you're a member of. One-time DBA setup:

```sql
-- mcp_reader is the connection identity (whatever you put in PG_USER)
GRANT finance              TO mcp_reader;
GRANT finance_restricted   TO mcp_reader;
GRANT payroll              TO mcp_reader;
GRANT payroll_restricted   TO mcp_reader;
GRANT hr                   TO mcp_reader;
GRANT hr_restricted        TO mcp_reader;
GRANT admissions           TO mcp_reader;
GRANT developer            TO mcp_reader;
```

**Critical:** the `mcp_reader` connection user itself **does not need any data grants**. It's a pure "membership-of-roles" identity. All real grants live on the actual roles. If `mcp_reader` is granted no data access of its own, it can never see anything outside `SET ROLE` — which means a configuration mistake (missing `set_role=` in an MCP key) results in a query that **fails** rather than a query that **leaks**.

### 4. Verify with `warehouse-mcp doctor`

After updating `.env` with the new `MCP_API_KEYS`, run:

```bash
warehouse-mcp doctor
```

It will report whether config parses, the warehouse is reachable, and auth is enabled. (It does not exhaustively try every key — that's a smoke-test job for the team distributing keys.)

### 5. Distribute the keys to teams

Each team receives *only their key*. Configure their AI client (Claude Desktop, Cursor, internal agent) with that key as the bearer token. See [install-claude-desktop.md](install-claude-desktop.md) and [install-cursor.md](install-cursor.md) for the per-client steps.

### 6. Verify role isolation end-to-end

For each role, have the team try a query that **should fail** under their grants:

- `payroll_restricted` user tries to `query` raw rows: should be denied at MCP layer (`metadata_only` doesn't allow `query`)
- `hr` user tries to read finance data: should be denied at DB layer (the `hr` DB role lacks SELECT on finance schemas)
- `developer` user tries to read everything: should succeed (admin tier + broad DB grants)

Both layers must reject correctly. If either layer alone allows what should be blocked, the configuration is wrong.

---

## How a request flows in this setup

1. AI agent (Claude Desktop / Cursor / custom) sends `Authorization: Bearer mno345…`
2. MCP looks up the key → `{role: reader_restricted, warehouseRole: hr}`
3. **MCP role check**: agent calls a tool. Is `reader_restricted` allowed to call it?
   - `query` or `search_value` → **denied at MCP layer**. The DB never sees the request.
   - `time_series`, `column_stats`, `top_values`, `sample_table`, etc. → allowed, proceed
4. Adapter checks out a connection from the pool (as `mcp_reader`)
5. Adapter issues `SET ROLE hr`
6. Query runs — Postgres now evaluates **all RLS, CLS, masking, and grants against `hr`**
7. Adapter issues `RESET ROLE`, releases the connection
8. Audit log captures both: `principal=key_o345...` (which MCP key) plus `warehouse_role=hr` (which DB role)

This is the spine of the architecture — the same flow runs for every tool. See [architecture.md](architecture.md) for a deeper view.

---

## What's in the audit log

Every tool call produces an audit record like:

```json
{
  "ts": "2026-05-06T14:42:11.873Z",
  "tenant_id": "default",
  "principal": "key_o345xyz",
  "role": "reader_restricted",
  "warehouse_role": "hr",
  "request_id": "req_xxx",
  "tool": "time_series",
  "sql": "SELECT DATE_TRUNC('month', applied_at) AS period, COUNT(*) ...",
  "row_count": 42,
  "duration_ms": 87,
  "guardrail_events": [
    { "guardrail": "output_pii_mask", "action": "transform", "reason": "masked 0 fields at level=full" }
  ]
}
```

You get **two layers of audit signal in one record**: who hit MCP (`principal`, `role`) and what DB identity actually ran the query (`warehouse_role`). Cross-correlate with your DB's own log (Postgres `pg_stat_activity` + `log_statement`) by query timestamp and SQL text to see the full trace from agent through to row read.

---

## Operational practices

### Rotating one role's key

```bash
NEW_KEY=$(openssl rand -hex 24)
# Update MCP_API_KEYS env (replace just that one entry)
# Restart the warehouse-mcp container
# Distribute the new key to that role's consumers
```

Other roles' keys are unaffected. Rotation cost: ~5 minutes per role, plus the key-distribution overhead to that team.

### Revoking a compromised key

Same process — drop the entry from `MCP_API_KEYS`, restart. Compromised key = no further access for that role's MCP path. The DB role itself remains untouched and continues to serve other consumers (BI tools, ETL jobs, etc.) that connect with their own credentials.

If the compromise scope is unclear, revoke the DB role's `GRANT … TO mcp_reader` as well — that severs `SET ROLE` access at the DB layer too. Belt and suspenders.

### Onboarding a new role

Three steps:

1. DBA: `CREATE ROLE marketing_restricted; GRANT … (data grants); GRANT marketing_restricted TO mcp_reader;`
2. Add `marketing_key:reader_restricted:set_role=marketing_restricted` to `MCP_API_KEYS`
3. Restart the warehouse-mcp container

No code changes ever. The architecture is designed so new roles plug in.

### Decommissioning a role

Reverse: drop the entry from `MCP_API_KEYS`, restart, then optionally `REVOKE marketing_restricted FROM mcp_reader` and `DROP ROLE marketing_restricted` at the DB layer when ready.

### Auditing role usage

Once a week, grep the audit log:

```bash
jq -r '[.warehouse_role, .role, .tool] | @tsv' /app/audit/audit-*.jsonl \
  | sort | uniq -c | sort -rn
```

Shows you which roles + MCP tiers + tools are actually being used. Roles that show no activity for weeks are candidates for review (still needed? still aligned with the team using them?).

---

## What this pattern does *not* do

### Per-user differentiation

With the static-keys-per-role pattern, MCP can't tell "Alice in finance" from "Bob in finance" — both authenticate with the `finance_key`, both run queries as the `finance` DB role. The audit log records the role, not the human.

If you need per-user identity (e.g., for compliance: "who in finance ran this report?" or for warehouse-side RLS that filters by `current_user()`), see the next section.

### Personalized DB-side RLS

DB row-level security policies that depend on `current_user()` won't differentiate between users behind the same MCP key. The DB sees them all as the same role identity.

### Cost differentiation

There's no per-key query budget today. A `developer`-tier key issuing expensive analytical queries costs the same as a `metadata_only` key calling catalog tools. Pair with your warehouse's cost monitors (Snowflake credit limits, BigQuery quotas, Postgres `statement_timeout` per role) for cost control.

---

## When to switch to OIDC for per-user identity

For "Alice in finance can run reports against rows tagged with her department, Bob in finance with his," static keys don't work. Switch to OIDC/JWT-based auth.

The mechanism (already wired in `src/auth/bearer.js`):

1. Your IdP (Okta / Azure AD / Auth0 / Google Workspace) issues JWTs to authenticated users with claims like:
   ```json
   {
     "sub": "alice@yourco.com",
     "role": "reader_restricted",
     "warehouse_role": "alice_finance"
   }
   ```
2. Set `MCP_OIDC_ISSUER` and `MCP_OIDC_AUDIENCE` in MCP. Don't set `MCP_API_KEYS` (or set both — bearer auth checks static keys first, then JWT).
3. The bearer middleware validates the JWT against your IdP's JWKS endpoint and reads `role` + `warehouse_role` from the verified claims.
4. Per-user DB roles (`alice_finance`, `bob_finance`) carry per-user grants on the DB side — typically managed via group membership in your DB-role-management system.
5. `mcp_reader` connection user remains the pool identity, but `SET ROLE` now switches to the per-user role from the JWT.

You don't need OIDC on day one. **Start with the role-key pattern in this guide.** Move to OIDC when one of these is true:

- Compliance requires per-user audit ("who in HR generated this report?")
- DB-side RLS uses `current_user()` and needs per-user evaluation
- You need to revoke individual users without rotating a shared key
- Your user count is large enough that key distribution becomes painful

The `set_role=` impersonation mechanism is the same in both worlds — only the identity source changes.

---

## See also

- [architecture.md](architecture.md) — the full request flow including where role checks fire
- [threat-model.md](threat-model.md) — the OWASP-mapped security view, including the impersonation rationale
- [adapters/postgres.md](adapters/postgres.md) — recommended Postgres-side grants for the connection user
- [troubleshooting.md](troubleshooting.md) — common failures (missing role membership, RLS policy gotchas, etc.)
- [onboarding.md](onboarding.md) — first-customer setup walkthrough (single-role baseline)
