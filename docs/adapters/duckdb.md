# DuckDB adapter

In-process DuckDB. Used for local development, demos, the smoke-test backend for the adapter contract suite, and as a thin client to **MotherDuck** (cloud-hosted DuckDB).

## Required env

```
WAREHOUSE_TYPE=duckdb
DUCKDB_PATH=:memory:           # or a file path: /data/analytics.duckdb
                               # or MotherDuck:   md:<database_name>
```

Three modes, one adapter:

| `DUCKDB_PATH` value | Mode | Persistence |
|---|---|---|
| `:memory:` | In-process, RAM only | Lost on restart |
| `/data/demo.duckdb` | Local file (mount it from host) | Persistent |
| `md:my_db` | **MotherDuck** cloud DB | Cloud-managed |

## MotherDuck (cloud-hosted DuckDB)

If you have a [MotherDuck](https://motherduck.com/) account, point the adapter at it via the `md:` prefix and add a service token:

```
WAREHOUSE_TYPE=duckdb
DUCKDB_PATH=md:sample_data
MOTHERDUCK_TOKEN=eyJhbG…   # from MotherDuck UI: Settings → Tokens → Service Account
```

The DuckDB driver auto-installs the `motherduck` extension on first connect — no extra setup. The token is sent only to MotherDuck and is never written to the audit log.

For the built-in `sample_data` database (which every MotherDuck account ships with), you can immediately ask things like *"list the schemas"* — Claude will see `nyc`, `who`, `hn` and other public datasets to query.

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
