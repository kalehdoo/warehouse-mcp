# Per-Module Deep Dives

These expand on the [Engineering Runbook](../runbook.md). Read the runbook first for the end-to-end picture, then use these for the detail on a specific area. Each module ends with a **rewrite checklist** and a **See also** cross-reference map.

Suggested reading order for a from-scratch rewrite (bottom-up, mirrors the dependency graph):

| # | Module | Files covered |
|---|---|---|
| 02 | [Configuration](./02-config.md) | `util/config.js` |
| 03 | [Context & auth](./03-context-and-auth.md) | `auth/context.js`, `bearer.js`, `jwt.js` |
| 07 | [Security](./07-security.md) | `security/policy.js`, `sqlValidator.js`, `rateLimit.js` |
| 08 | [Adapters](./08-adapters.md) | `adapters/*`, `util/sqlDialect.js` |
| 06 | [Tools](./06-tools.md) | `tools/*` |
| 05 | [Server & registration](./05-server-and-registration.md) | `server.js`, `tools/registerAll.js` |
| 04 | [Transports](./04-transports.md) | `transport/stdio.js`, `http.js` |
| 01 | [Entry & bootstrap](./01-entry-and-bootstrap.md) | `bin/`, `cli/`, `index.js` |
| 09 | [Guardrails](./09-guardrails.md) | `guardrails/*` |
| 10 | [Audit & observability](./10-audit-and-observability.md) | `audit/`, `observability/`, `util/resultCap.js` |
| 11 | [Semantic layer](./11-semantic.md) | `semantic/*` |
</content>
