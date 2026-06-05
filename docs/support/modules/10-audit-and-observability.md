# Module 10 — Audit & Observability

> Expands on [Runbook §8](../runbook.md#8-cross-cutting-concerns) (audit / result-cap / observability rows).
> Files: [`src/audit/jsonlSink.js`](../../../src/audit/jsonlSink.js), [`src/util/resultCap.js`](../../../src/util/resultCap.js), [`src/observability/otel.js`](../../../src/observability/otel.js).

## Purpose

Make every action **accountable** (audit), **bounded** (result cap), and **observable** (tracing). These are the "every action is logged" half of the product promise.

## `audit/jsonlSink.js` — the audit log

`JsonlAuditSink` writes **one JSONL record per tool call** (step 7 of the [pipeline](./05-server-and-registration.md)). Design choices:
- **Append-only, synchronous** `appendFileSync`. Audit volume is one record per tool call (not the hot data path), so sync cost is negligible and it sidesteps a whole class of buffer/close races.
- **Daily rotation** (`audit-YYYY-MM-DD.jsonl`) by UTC day, or a single `audit.jsonl` when `rotation: "off"`.
- **Field clipping** — string fields (`sql`, `error`) are clipped to `fieldMaxBytes` (default 4096) so a hostile prompt can't fill the disk via huge SQL or error text. `JSON.stringify` already escapes control chars, so there's no log-injection-via-newline risk.
- **Never throws** — the `write` body is wrapped so an audit failure can never break a tool call.

### Record shape
`{ts, tenant_id, principal, role, warehouse_role, include_semantic, request_id, tool, sql, row_count, duration_ms, truncated, error, guardrail_events}`. Everything needed to reconstruct *who did what, under which role, with what result, and whether a guardrail fired* — including `include_semantic` so you can explain after the fact why one principal's queries were more precise than another's on the same tools.

`close()` is a no-op (sync sink) kept for API compatibility with the shutdown handler in [module 01](./01-entry-and-bootstrap.md).

## `util/resultCap.js` — bounding result size

`applyResultCap(result, maxCells)` caps tabular results at `cells = rows × columns` (step 5 of the pipeline). When exceeded, it slices rows to fit and adds `truncated: true`, `original_row_count`, and `cap_cells` so the **agent can react** rather than silently getting partial data. `QUERY_MAX_RESULT_CELLS=0` disables it. Default 100k cells covers ~1000×100 or ~10k×10 — almost every real analytical question — while preventing an agent loop from exhausting memory or saturating the response stream.

## `observability/otel.js` — tracing

`maybeInitTracing(name, version)` is called **first** in `main()` so all later spans are captured. The [pipeline](./05-server-and-registration.md) wraps each tool call in `withSpan("tool.<name>", fn, {warehouse.tenant, warehouse.role})`. Tracing is **optional** — when the OTel exporter isn't configured, `withSpan` is a thin pass-through, so observability adds nothing to deployments that don't use it.

## Why it's built this way
- **Sync append for audit** trades a microscopic latency cost for correctness (no lost records on crash, no flush races). Correct beats clever for an audit log.
- **Clip, don't drop** — oversized fields/results are truncated with a flag, never silently discarded, so neither the auditor nor the agent is misled.
- **Audit is unconditional and crash-safe** — it runs on success, denial, and exception, and its own failures are swallowed.
- **Observability is zero-cost when off** so it can be always-present in code without taxing simple deployments.

## Gotchas
- Don't move audit writes off the synchronous path "for performance" — the volume doesn't warrant it and you'd reintroduce loss-on-crash.
- `truncated`/`original_row_count` must survive guardrail post-processing — keep the cap before `runPost` (it is) so the flag reaches the audit and the agent.
- Field clipping is a disk-safety control, not a privacy control; PII redaction is the [guardrail](./09-guardrails.md)'s job.

## Rewrite checklist
- [ ] JSONL sink: append-only, sync, daily rotation, field clipping, never throws.
- [ ] Record carries identity (`tenant/principal/role/warehouse_role`), `request_id`, tool, sql, row_count, duration, truncated, error, guardrail_events.
- [ ] `applyResultCap` caps by cells and flags truncation; `0` disables.
- [ ] Tracing initialized first; `withSpan` wraps each tool call; no-op when unconfigured.

## See also
- Where audit/cap/spans are invoked → [module 05](./05-server-and-registration.md)
- Source of the identity fields → [module 03](./03-context-and-auth.md)
- Guardrail events in the record → [module 09](./09-guardrails.md)
- Safety config (`maxResultCells`, `auditFieldMaxBytes`) → [module 02](./02-config.md)
</content>
