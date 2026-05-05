/**
 * Warehouse adapter contract. Every adapter implements these methods.
 * v1 is read-only; write methods land in v2 behind ENABLE_WRITE_TOOLS.
 *
 * @typedef {object} ColumnMeta
 * @property {string} name
 * @property {string} type
 * @property {boolean} [nullable]
 *
 * @typedef {object} TableMeta
 * @property {string} schema
 * @property {string} name
 * @property {"table"|"view"} [kind]
 *
 * @typedef {object} QueryResult
 * @property {ColumnMeta[]} columns
 * @property {Array<Record<string, unknown>>} rows
 *
 * @typedef {object} WarehouseAdapter
 * @property {"postgres"|"oracle"|"redshift"|"snowflake"|"bigquery"|"duckdb"} type
 * @property {(sql: string) => Promise<QueryResult>} query
 * @property {() => Promise<string[]>} listSchemas
 * @property {(schema: string) => Promise<TableMeta[]>} listTables
 * @property {(schema: string, table: string) => Promise<ColumnMeta[]>} describeTable
 * @property {(schema: string, table: string, n: number) => Promise<QueryResult>} sample
 * @property {() => Promise<void>} close
 */
export {};
