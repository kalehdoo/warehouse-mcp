# Module 11 — Semantic Layer

> Expands on [Runbook §4.2, §5.1, §8](../runbook.md#8-cross-cutting-concerns) (semantic rows).
> Files: [`src/semantic/index.js`](../../../src/semantic/index.js), [`loader.js`](../../../src/semantic/loader.js), [`schema.js`](../../../src/semantic/schema.js), [`resources.js`](../../../src/semantic/resources.js), and the lookup tools in [`src/tools/semantic.js`](../../../src/tools/semantic.js).

## Purpose

An **optional** layer that loads a customer's business metadata (glossary terms, schema docs, table/column docs) from YAML and exposes it two ways: as MCP **resources** (`warehouse://semantic/*`) and as in-memory **lookup tools**. It makes the agent's queries more precise by giving it business context the raw catalog can't provide — without touching the warehouse.

## `index.js` — the public API
- `loadSemantic({dir})` — returns `{index, enabled, missingDir?}`. Fully optional: unset dir → empty index, disabled; missing dir → empty index + warning; a path that exists but isn't a directory → throws. Called once in `main()` ([module 01](./01-entry-and-bootstrap.md)).
- `registerSemanticResources(server, index)` — attaches the MCP resources to a session's server.
- `summarize(index)` — one-line stats for boot logging and `doctor`.

## `loader.js` — `loadSemanticDir(dir)`
Recursively walks the dir for `*.yml`/`*.yaml` and classifies each file by name:
- `glossary.yml` → business-glossary terms,
- `schemas.yml` → schema-level docs,
- anything else → dbt-style models file (tables + columns).

Each file is validated against the matching zod schema ([`schema.js`](../../../src/semantic/schema.js)) and merged into an in-memory index of `Map`s: `glossary`, `schemaDocs`, `tables`, and a derived `schemas` (schema → its tables).

**Fail-fast on startup** if: a glossary term is defined twice, a schema is documented twice, the same `(schema, table)` appears in two models files, or any file fails validation. Rationale (from the header): the cost of a malformed semantic file is the agent reading wrong metadata for the entire session — better to refuse to boot.

## `resources.js` — `registerSemanticResources(server, index)`
Exposes the index as MCP resources under `warehouse://semantic/*` so a client can read the glossary/schema/table docs as content. Registered per session, gated by `buildServer` (see below).

## `tools/semantic.js` — the lookup tools
`glossary_lookup`, `schema_lookup`, `table_lookup` read the in-memory index directly — **no warehouse I/O**. Because they're effectively free, every role gets them, and the `semantic_only` role ([module 07](./07-security.md)) gets **only** them — a docs-viewer persona for non-technical stakeholders who should never touch live data.

## The three gates (per-session opt-in)
`buildServer` ([module 05](./05-server-and-registration.md)) registers the semantic **resources** only if all three hold:
1. `ctx.includeSemantic !== false` — the session opted in,
2. `deps.semantic` was wired through, and
3. the index has content (`glossary.size > 0 || tables.size > 0`).

`includeSemantic` is resolved per session (API-key option → JWT claim → `SEMANTIC_DEFAULT`), so two users on the same deployment can disagree about semantic resources **without a restart** (see [module 03](./03-context-and-auth.md)).

## Why it's built this way
- **Optional and fail-fast.** It's off unless `SEMANTIC_DIR` is set, but once on, bad metadata stops the boot rather than silently misleading the agent all session.
- **Two surfaces, one index.** Resources (browseable docs) and lookup tools (queryable) read the same in-memory `Map`s — no warehouse round-trip, so they're cheap enough to grant broadly.
- **Per-session gating** turns one deployment into many personas (full reader, metadata-only, docs-viewer) by config alone.

## Rewrite checklist
- [ ] `loadSemantic` is fully optional and distinguishes unset / missing / not-a-dir.
- [ ] Loader classifies by filename, validates with zod, fails fast on collisions/invalid.
- [ ] Index is in-memory `Map`s; lookup tools never hit the warehouse.
- [ ] Resources registered only behind the three gates.
- [ ] `includeSemantic` precedence: key → JWT → server default.

## See also
- The three gates live in → [module 05](./05-server-and-registration.md)
- `includeSemantic` resolution → [module 03](./03-context-and-auth.md)
- `semantic_only` role → [module 07](./07-security.md)
- The lookup tools as part of the catalog → [module 06](./06-tools.md)
</content>
