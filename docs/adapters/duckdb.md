# DuckDB adapter

In-process DuckDB. Used for local development, demos, and as the smoke-test backend for the adapter contract suite. Production use is fine for read-only analysis of files (Parquet, CSV, JSON) without standing up a real warehouse.

## Required env

```
WAREHOUSE_TYPE=duckdb
DUCKDB_PATH=:memory:           # or a file path: /data/analytics.duckdb
```

Use `:memory:` for ephemeral demos; use a file path for persistent data. Both work the same way through the adapter.

## What works in v1

- All five v1 read operations (`query`, `list_schemas`, `list_tables`, `describe_table`, `sample_table`)
- `sample_table` uses `USING SAMPLE n ROWS` — DuckDB's reservoir sampler

## Reading external files

DuckDB can query Parquet, CSV, JSON, and Iceberg directly:

```sql
SELECT * FROM read_parquet('/data/orders/*.parquet') LIMIT 10;
SELECT * FROM read_csv_auto('/data/customers.csv') LIMIT 10;
```

These show up in `list_tables` only after you `CREATE VIEW` over them — DuckDB's catalog doesn't know about ad-hoc table functions.

## Gotchas

- Single-process. Two `warehouse-mcp` instances pointing at the same DuckDB file will conflict on writes (not a concern for our read-only surface, but worth knowing).
- DuckDB's `information_schema.columns.is_nullable` returns `'YES'` / `'NO'` — the adapter normalizes to `boolean`.
- The native `duckdb` npm package has prebuilt binaries for macOS arm64/x64, Linux x64/arm64, and Windows x64. If you're on an unusual platform, install will fall back to compiling from source — slow but works.
