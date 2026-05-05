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
 * @typedef {object} ColumnMatch
 * @property {string} schema
 * @property {string} table
 * @property {string} column
 * @property {string} type
 *
 * @typedef {object} ForeignKeyEdge
 * @property {string} from_schema
 * @property {string} from_table
 * @property {string} from_column
 * @property {string} to_schema
 * @property {string} to_table
 * @property {string} to_column
 * @property {string} [constraint_name]
 *
 * @typedef {object} QueryResult
 * @property {ColumnMeta[]} columns
 * @property {Array<Record<string, unknown>>} rows
 *
 * @typedef {object} QueryOptions
 * @property {string} [warehouseRole]  When set, the adapter issues `SET ROLE` (or
 *                                     equivalent) on the connection before running
 *                                     the SQL, so warehouse-side RLS / CLS / masking
 *                                     policies are evaluated under that identity.
 *                                     Supported on Postgres + Redshift today.
 *                                     Other adapters throw UNSUPPORTED if asked.
 *
 * @typedef {object} WarehouseAdapter
 * @property {"postgres"|"oracle"|"redshift"|"snowflake"|"bigquery"|"duckdb"} type
 * @property {(sql: string, opts?: QueryOptions) => Promise<QueryResult>} query
 * @property {() => Promise<string[]>} listSchemas
 * @property {(schema: string) => Promise<TableMeta[]>} listTables
 * @property {(schema: string, table: string) => Promise<ColumnMeta[]>} describeTable
 * @property {(schema: string, table: string, n: number) => Promise<QueryResult>} sample
 * @property {(pattern: string, opts?: {schema?: string}) => Promise<ColumnMatch[]>} findColumns
 * @property {(opts?: {schema?: string, table?: string}) => Promise<ForeignKeyEdge[]>} getForeignKeys
 * @property {(schema: string, view: string) => Promise<string>} getViewDefinition
 * @property {() => Promise<void>} close
 */
export {};
