# Semantic-metadata templates

This directory contains starter templates for the optional semantic-metadata layer that warehouse-mcp v0.4+ exposes as MCP resources.

## What you'd do as a customer

1. **Copy the templates** to a new directory you'll mount into the container:
   ```bash
   mkdir -p ~/warehouse-semantic
   cp docs/semantic-templates/*.yml ~/warehouse-semantic/
   ```

2. **Edit them** to describe your actual warehouse — replace the example finance/invoices/customers/subscriptions tables with yours, replace the example glossary terms (`active_customer`, `revenue`, `mrr`) with your business's terms.

3. **Point warehouse-mcp at the directory** by setting `SEMANTIC_DIR=/path/to/your/semantic` in the env (or in `secrets/<warehouse>.env`). Restart the server.

4. **Verify** with `warehouse-mcp doctor` — it lists how many glossary terms and tables it loaded. If any file failed validation, doctor names the file and the schema error.

5. The AI agent automatically sees the new MCP resources at `warehouse://semantic/*` and consults them before constructing queries.

## Files in this directory

| File | What it documents |
|---|---|
| `glossary.yml` | Business terms (`active_customer`, `revenue`, `mrr`, etc.) — the agent's dictionary for understanding the domain language |
| `schemas.yml` | Schema-level docs (one entry per warehouse schema) — what each schema is for, who owns it, refresh cadence, sensitivity. The agent's "table of contents" view of the warehouse. |
| `finance.yml` | Tables in the `finance` schema — descriptions, columns, types, sensitivity tags |

## Layout — your call

The loader walks `SEMANTIC_DIR` recursively, so you can organize files however suits your team:

- **One file per warehouse schema** (recommended for most): `finance.yml`, `hr.yml`, `payroll.yml`, …
- **One file per table** (good when individual tables have different owners): `finance/invoices.yml`, `finance/customers.yml`, …
- **dbt-mirrored** (recommended for dbt customers): point `SEMANTIC_DIR` at your `dbt_project/models/` directory; existing `schema.yml` files are picked up directly. (Add `meta.schema:` to each model — that's the only warehouse-mcp extension to dbt's vanilla format.)

The URI scheme stays the same regardless: `warehouse://semantic/tables/<schema>/<table>` always means the same thing.

## What goes in `meta:`

The `meta` block on a model or column carries warehouse-mcp-aware fields plus anything else you want to stash. Recognized fields:

### Model-level

| Key | Type | Use |
|---|---|---|
| `schema` *(required)* | string | The warehouse schema this table lives in |
| `owner` | string | Team / individual responsible |
| `refresh` | enum | `realtime`, `hourly`, `daily`, `weekly`, `monthly`, `manual`, `view` |
| `sensitivity` | enum | `low`, `medium`, `high`, `secret` |
| `purpose` | enum | `raw`, `staging`, `intermediate`, `mart`, `snapshot`, `reference` |
| `glossary_terms` | list of strings | Glossary terms most relevant to this table |

### Column-level

| Key | Type | Use |
|---|---|---|
| `sensitivity` | enum | Same scale as model-level |
| `unit` | string | Free-text — `USD_cents`, `seconds`, `count`, etc. |
| `glossary_terms` | list of strings | Glossary terms this column relates to |
| `allowed_values` | list of strings | If the column is an enum, list valid values |
| `sample_values` | list of strings | Optional examples for the agent |
| `deprecated` | bool | If true, agent should avoid recommending this column |

Anything not in the above list passes through untouched — useful if you want to stash project-specific tags (`pii_review_date`, `gdpr_basis`, etc.) alongside.

## Validation

`warehouse-mcp doctor` validates the entire `SEMANTIC_DIR`:

- Every YAML file parses (no syntax errors)
- Each file matches its schema (glossary or models)
- No two files define the same table
- No two files define the same glossary term

Fix the failing file's path that doctor names, restart, and the resources go live.

## How the agent uses it

When a user asks *"show me revenue from active customers last quarter"*, an agent that uses the resources will typically:

1. Read `warehouse://semantic/glossary` to learn what your business means by *revenue* and *active customer*
2. Read `warehouse://semantic/schemas/finance` to understand which schema holds the relevant tables
3. Read `warehouse://semantic/tables/finance/invoices` to see the columns and their meaning
4. Construct a query using the glossary's `sql_definition` as scaffolding, joined with what it learned about the table
5. Issue the query via `query` tool

Without semantic resources, step 1–3 are guesswork — the agent infers from table names and column names alone, which is brittle. The resources turn guesswork into recipe-following.

## Optional: full schema path

For a complete production setup, you'd typically have:

```
~/warehouse-semantic/
├── glossary.yml
├── finance.yml
├── hr.yml
├── payroll.yml
├── admissions.yml
└── …
```

One glossary file (top-level), one file per schema you want to expose. Add or remove schemas independently as your warehouse evolves.
