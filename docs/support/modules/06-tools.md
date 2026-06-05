# Module 06 — Tools

> Expands on [Runbook §5.1](../runbook.md#51-the-catalog--srctoolsindexjs).
> Files: [`src/tools/index.js`](../../../src/tools/index.js), [`query.js`](../../../src/tools/query.js), [`catalog.js`](../../../src/tools/catalog.js), [`profile.js`](../../../src/tools/profile.js), [`search.js`](../../../src/tools/search.js), [`semantic.js`](../../../src/tools/semantic.js).

## Purpose

Define the **verbs** the agent can call. Each tool is a small, declarative object; all the cross-cutting machinery lives in the [registration pipeline](./05-server-and-registration.md), so tools stay focused on "construct a safe query, call the adapter, shape the result."

## The tool shape

```js
export const fooTool = {
  name: "foo",
  description: "…",            // shown to the agent; write it for an LLM reader
  inputSchema: { /* zod */ },  // validated by the MCP SDK before handler runs
  async handler(args, ctx, deps) { /* … */ },
};
```

Handlers receive `(args, ctx, deps)` and **return plain data** (object or string). They never format MCP `content` — the wrapper does that.

## The catalog — `index.js`

`TOOL_DEFINITIONS` is an **ordered** array. Order is significant for two reasons (per its comment): MCP's `tools/list` preserves insertion order, and tool-centric clients let ordering nudge the agent's priors. Semantic-lookup tools are placed **first** so the `semantic_only` role sees only them.

| Group | Tools | DB I/O? |
|---|---|---|
| Semantic lookups | `glossary_lookup`, `schema_lookup`, `table_lookup` | No — in-memory Map reads |
| Free-form | `query` | Yes |
| Catalog discovery | `list_schemas`, `list_tables`, `describe_table`, `find_columns`, `get_foreign_keys`, `get_view_definition` | Yes (metadata) |
| Single-table profiling | `sample_table`, `count_rows`, `column_stats`, `top_values`, `time_series` | Yes |
| Search | `search_value` | Yes |

## The three handler patterns

### Pattern A — free-form SQL (`query.js`)
The only tool that runs user-supplied SQL. It **must** pass through `normalizeReadOnlySql(sql, {dialect, defaultLimit, maxLimit})` ([module 07](./07-security.md)) before reaching `adapter.query`. This is the riskiest tool and the reason the validator exists.

### Pattern B — catalog (`catalog.js`)
Thin pass-throughs to the adapter's metadata methods (`listSchemas`, `listTables`, `describeTable`, `findColumns`, `getForeignKeys`, `getViewDefinition`). No SQL is constructed in the tool; the adapter owns the dialect-specific catalog queries. Handlers just wrap the result with a little context (`schema`, `count`, …).

### Pattern C — server-constructed SQL (`profile.js`, `search.js`)
These build SQL **themselves** using the cross-dialect helpers in [`util/sqlDialect.js`](../../../src/util/sqlDialect.js) — `qualifiedTable`, `quoteIdent`, `quoteLiteral`, `limitClause`, `dateTrunc`, `isNumericType`, `isTextType`. Because the SQL is generated (not user-supplied), they call the lighter `assertReadOnly(sql)` as a final defensive check rather than the full normalizer. Examples:
- `column_stats` — looks up the column, picks `AVG` only for numeric types, builds one aggregate query.
- `top_values` — `GROUP BY ... ORDER BY COUNT(*) DESC` with a dialect-correct limit.
- `time_series` — `dateTrunc(period, col, dialect)` buckets; requires `metric_column` for non-`count` aggregates.
- `search_value` — scans up to 10 text columns, `UNION ALL` of per-column equality matches, each branch wrapped in a subselect so the per-branch limit applies before the UNION (required by BigQuery/Oracle).

> **Security rule for Pattern C:** every identifier goes through `quoteIdent`, every literal through `quoteLiteral`, and the assembled SQL through `assertReadOnly`. Never string-concatenate a raw identifier or value. `warehouseRole` is forwarded to the adapter on every call so warehouse-native RLS still applies.

### Semantic lookups (`semantic.js`)
`glossary_lookup`, `schema_lookup`, `table_lookup` read the in-memory semantic index ([module 11](./11-semantic.md)) — no warehouse round-trip. They're "free," which is why every role gets them and `semantic_only` gets *only* them.

## Why it's built this way
- **Declarative tools, centralized enforcement.** A tool can't forget to rate-limit or audit because it never does those things — the wrapper does.
- **Three patterns, clear rules.** Free-form SQL → full normalizer; adapter metadata → no SQL in the tool; generated SQL → dialect helpers + `assertReadOnly`.
- **Descriptions are prompts.** The `description` text is consumed by the agent; treat it as part of the product surface, not a code comment.

## Rewrite checklist
- [ ] Tool = `{name, description, inputSchema, handler}`; handler returns plain data.
- [ ] `query` always normalizes SQL; profiling/search always `assertReadOnly` generated SQL.
- [ ] All identifiers/literals in generated SQL go through `quoteIdent`/`quoteLiteral`.
- [ ] `ctx.warehouseRole` forwarded to `adapter.query`/`adapter.sample`.
- [ ] Semantic lookups touch only the in-memory index.
- [ ] `TOOL_DEFINITIONS` order: semantic lookups first.

## See also
- How tools get wrapped → [module 05](./05-server-and-registration.md)
- `normalizeReadOnlySql` / `assertReadOnly` → [module 07](./07-security.md)
- Adapter methods they call + `sqlDialect` helpers → [module 08](./08-adapters.md)
- The semantic index → [module 11](./11-semantic.md)
</content>
