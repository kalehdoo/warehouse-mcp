# Semantic metadata

> *Available in v0.4+. Optional — warehouse-mcp works fine without it.*

The semantic-metadata layer lets you teach an AI agent **what your warehouse means**, not just what's in it. With it, the agent can answer "show me revenue from active customers last quarter" by *reading your business's actual definition* of "revenue" and "active customer" — instead of guessing from column names.

## When it's worth setting up

| You should configure semantic metadata if … | Skip it if … |
|---|---|
| The agent keeps misinterpreting business terms (uses wrong table for "revenue", wrong predicate for "active") | You're a single team using a single warehouse you wrote yourself; the agent already infers correctly |
| You have business logic in views and the agent needs to know what they mean | All your tables are self-describing (well-named, well-typed, no hidden semantics) |
| You have a dbt project — most of the metadata is already written | You're running a personal project where wrong inferences don't matter |

## How it works in 30 seconds

You write YAML files describing your warehouse. warehouse-mcp loads them at startup and exposes the contents as MCP **resources** at URIs like `warehouse://semantic/tables/finance/invoices`. The AI client reads these resources before issuing queries — they're cacheable, addressable, and discoverable without the agent having to make a tool call.

```
SEMANTIC_DIR=/path/to/my/semantic     ←  point warehouse-mcp at the directory
                              ↓
   ┌──────────────────────────────────────────────────────┐
   │   /my/semantic/                                       │
   │   ├── glossary.yml      ← business terms              │
   │   ├── finance.yml       ← finance-schema tables       │
   │   ├── hr.yml            ← hr-schema tables            │
   │   └── …                                               │
   └────────────────────┬─────────────────────────────────┘
                        ↓ loaded + indexed at startup
   warehouse-mcp serves at:
     warehouse://semantic/glossary
     warehouse://semantic/glossary/{term}
     warehouse://semantic/schemas/list
     warehouse://semantic/schemas/{schema}
     warehouse://semantic/tables/{schema}/{table}
```

Five URI patterns. AI clients call them like any MCP resource — the agent's prompt template can include "always read the glossary first" so this becomes part of its standard workflow.

## Setup in five steps

### 1. Create the directory

Anywhere convenient — your repo, a Git submodule, a mounted volume:

```bash
mkdir -p ~/my-warehouse-semantic
cp -r warehouse-mcp/docs/semantic-templates/*.yml ~/my-warehouse-semantic/
```

### 2. Edit the templates

Open `glossary.yml` and replace the example terms (`active_customer`, `revenue`, `mrr`) with **your** business's terms. Keep the format; change the content.

Open `finance.yml` (or rename to match a real schema in your warehouse) and replace the example tables with yours. Each `models[].name` is a real table; each `meta.schema` is the warehouse schema it lives in.

You don't need to document every table on day one. Start with the **5–10 tables the agent gets confused by most often** plus the **20 most-used business terms**. Add more as you encounter agent mistakes.

### 3. Point warehouse-mcp at the directory

Add to your `.env` (or `secrets/<warehouse>.env`):

```
SEMANTIC_DIR=/Users/you/my-warehouse-semantic
```

Or with Docker:

```bash
docker run ... \
  -v ~/my-warehouse-semantic:/app/semantic:ro \
  -e SEMANTIC_DIR=/app/semantic \
  ghcr.io/kalehdoo/warehouse-mcp:latest
```

### 4. Restart and verify

```bash
warehouse-mcp doctor
# Should print something like:
# ✓ Semantic dir loaded  3 glossary terms, 12 tables across 2 schemas
```

If anything's wrong (YAML syntax error, missing required field, two files defining the same table), doctor names the file and the specific issue. Fix and retry.

### 5. Confirm the agent uses it

Connect to the server with your AI client (Claude Desktop, Cursor, etc.). Ask the agent: *"What MCP resources are available?"* — it should list the five `warehouse://semantic/*` patterns.

Then ask a domain question: *"show me revenue from active customers last quarter"*. If the agent now (a) reads the glossary first and (b) uses your `revenue` SQL definition correctly, the integration is live.

## File formats

### `glossary.yml` — business terms

One file per warehouse, at the root of `SEMANTIC_DIR`. Format:

```yaml
version: 1
terms:
  - name: <identifier>            # how the agent will refer to it
    definition: |
      Plain-English explanation of what the term means in your business.
    sql_definition: |             # OPTIONAL but high-leverage
      <SQL the agent can use to compute this>
    related_terms: [<other_term>] # OPTIONAL
    tags: [<tag>, <tag>]          # OPTIONAL
```

The `sql_definition` is the most powerful field. When the agent sees a question that maps to a glossary term that has SQL, it has a known-correct starting point — it doesn't have to invent the predicate.

### `schemas.yml` — schema-level docs (v0.4.1+)

One file per warehouse, at the root of `SEMANTIC_DIR`. Tells the AI what each warehouse schema is *for*, not just what tables it contains. Without it, the agent has to infer the purpose of `finance` vs `raw_finance` vs `staging_finance` from naming alone — brittle.

```yaml
version: 1
schemas:
  - name: <schema_name>           # warehouse schema this entry describes
    description: |
      What kind of data lives in this schema. Source of truth for what?
      Anything an analyst would want to know in the first 30 seconds.
    owner: <team>                 # optional
    purpose: mart                 # raw | staging | intermediate | mart | snapshot | reference
    refresh: hourly               # realtime | hourly | daily | weekly | monthly | manual | view
    sensitivity: medium           # low | medium | high | secret
    glossary_terms: [<term>]      # related glossary entries
```

A schema can appear in `schemas.yml` even if no tables are documented in it yet — useful when you want to advertise a schema's existence and purpose before filling in per-table docs. The schema appears in `warehouse://semantic/schemas/list` regardless of whether tables have been documented.

### `<schema>.yml` (or any name except `glossary.yml` / `schemas.yml`) — table docs

Format follows dbt's `schema.yml` v2 spec:

```yaml
version: 2
models:
  - name: <table_name>
    description: |
      What this table represents, who owns it, when it refreshes, anything
      surprising about its semantics. Multi-paragraph is fine.
    meta:
      schema: <warehouse_schema>     # REQUIRED — which DB schema the table is in
      owner: <team>                  # optional
      refresh: hourly                # optional
      sensitivity: medium            # optional
      purpose: mart                  # optional
      glossary_terms: [<term>, ...]  # optional
    columns:
      - name: <column_name>
        description: |
          What the column means, including any business-specific quirks
          (units, special values, edge cases).
        meta:
          sensitivity: low           # optional
          unit: USD_cents            # optional
          glossary_terms: [<term>]   # optional
          allowed_values: [...]      # optional, for enums
```

Most fields are optional. The minimum viable entry is `name`, `description`, `meta.schema` — the agent can use even sparse docs.

## Layout flexibility

You can split the YAML however suits your team. The loader walks `SEMANTIC_DIR` recursively and builds an index from the union of all files; no two files may define the same `(schema, table)` or the same glossary term.

Three common layouts:

```
# One file per schema (default for most)
semantic/
├── glossary.yml
├── finance.yml
├── hr.yml
└── payroll.yml

# One file per table (heavier but useful when CODEOWNERS rules differ)
semantic/
├── glossary.yml
├── finance/
│   ├── invoices.yml
│   ├── customers.yml
│   └── subscriptions.yml
└── hr/
    └── ...

# dbt-mirrored (point SEMANTIC_DIR at your dbt models/ directory)
SEMANTIC_DIR=/repo/dbt_project/models
# Files live where dbt put them: models/staging/finance/schema.yml etc.
# Just add `meta.schema:` to each model.
```

## What this is NOT

- **Not lineage.** Lineage (table A is built from table B) lands in a future release — likely v0.5 with dbt-manifest auto-import. Today's semantic layer is description + glossary.
- **Not row-level access control.** That's `set_role=` impersonation in `MCP_API_KEYS`. See [multi-role-deployment.md](multi-role-deployment.md).
- **Not a runtime cost.** Semantic data is loaded once at boot, served from memory. No per-request overhead.
- **Not synced from your warehouse automatically.** It's a YAML you maintain. Drift is possible — `doctor` will eventually warn when a documented column doesn't exist in the warehouse, but it doesn't auto-update from `information_schema`.

## Drift management

Semantic docs go stale when the warehouse changes. Two practices help:

1. **Treat the YAML as code.** Put it in version control next to your dbt project (or its own repo). Review changes via PR.
2. **Validate against the warehouse periodically.** A future `warehouse-mcp validate-semantic` will check that every documented column exists in the warehouse. For now, the easiest approach is: when the warehouse schema changes, search the YAML for the old column name and update.

If the agent ever returns *"I read the docs but column X doesn't seem to exist in the warehouse"* — that's drift. Update the YAML.

## See also

- [docs/semantic-templates/README.md](semantic-templates/README.md) — the templates with comments
- [architecture.md](architecture.md) — the full request flow including resource serving
- [multi-role-deployment.md](multi-role-deployment.md) — role-based access (separate concern from semantic metadata)
- dbt's `schema.yml` reference — https://docs.getdbt.com/reference/configs-and-properties#schema-yml-files
