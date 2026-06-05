# Module 09 — Guardrails

> Expands on [Runbook §8](../runbook.md#8-cross-cutting-concerns) (guardrails row).
> Files: [`src/guardrails/index.js`](../../../src/guardrails/index.js), [`pipeline.js`](../../../src/guardrails/pipeline.js), [`types.js`](../../../src/guardrails/types.js), [`post/outputPiiMask.js`](../../../src/guardrails/post/outputPiiMask.js).

## Purpose

A pluggable interception layer that runs **before** a tool handler (to allow / deny / require approval) and **after** it (to transform the result — e.g. mask PII). Guardrails are how a deployment adds policy without modifying tools.

## `index.js` — the registry
`buildGuardrailPipeline(env)` assembles the configured pipeline at boot. Each guardrail is **opt-in via its own env knob** so a deployment that doesn't need a layer doesn't pay for it:

```
GUARDRAIL_PII_MASK=on  → adds outputPiiMask to the post chain
```

Add a guardrail by importing it and gating registration on an env var. Returns a `GuardrailPipeline({pre, post})`.

## `pipeline.js` — the runner

### `runPre(ctx, toolName, args)`
Runs pre-guardrails **in order**, accumulating events. Returns the **first non-`allow`** result (`deny` / `approve_required`) and short-circuits; otherwise `{action:"allow"}`. **Fail-closed:** if a guardrail's `evaluate()` *throws* (a bug, not a deny), the pipeline returns a hard `deny` — a buggy guardrail must never silently let a call through.

### `runPost(ctx, toolName, args, result)`
Runs post-guardrails **in order**, each receiving the previous one's (possibly transformed) result. **Fail-open-but-logged:** if a post-guardrail throws, it's skipped (the result passes through untransformed) and an event is recorded — a masking bug shouldn't blank out the whole response, but it must be visible in the audit.

> The asymmetry is deliberate: **pre** fails closed (security gate — deny on doubt); **post** fails safe-for-availability but logs (transform — don't destroy the response, but flag it).

## `types.js` — the contracts
Defines `PreGuardrail` / `PostGuardrail` (`{name, evaluate(...)}`), `PreGuardrailResult` (`{action: "allow"|"deny"|"approve_required", reason?, event?}`), and `GuardrailEvent` (what lands in the audit log).

## `post/outputPiiMask.js` — the shipped post-guardrail
Masks PII patterns in tool output before it returns to the agent. It's a *post* guardrail because it transforms results, and it's opt-in (`GUARDRAIL_PII_MASK`). Emits a `GuardrailEvent` so the audit records that masking occurred.

## Where it plugs in
The [registration pipeline](./05-server-and-registration.md) calls `runPre` at step 3 (a non-allow result short-circuits with a `Denied:`/`Approval required:` message and an audit write) and `runPost` at step 6 (after the result cap, before the audit). Every tool inherits all configured guardrails automatically — no per-handler code.

## Why it's built this way
- **Opt-in per layer** keeps surprising behavior (e.g. masking) out of deployments that didn't ask for it.
- **Fail-closed pre / fail-safe-logged post** matches each phase's risk: denial gates must not leak, transforms must not destroy.
- **Events, not just actions** so the audit can explain *why* a call was denied or *that* output was masked.

## Rewrite checklist
- [ ] `buildGuardrailPipeline` assembles pre/post from env knobs.
- [ ] `runPre` short-circuits on first non-allow; throws → deny.
- [ ] `runPost` chains transforms; throws → skip + log event.
- [ ] Guardrails emit `GuardrailEvent`s that reach the audit log.
- [ ] PII mask is a post guardrail, opt-in.

## See also
- Where `runPre`/`runPost` are invoked → [module 05](./05-server-and-registration.md)
- Where guardrail events are written → [module 10](./10-audit-and-observability.md)
- `ctx` passed to `evaluate` → [module 03](./03-context-and-auth.md)
</content>
