/** Vocabulario de ETL-DSL v0.2 (etl_dsl/grammar.lark). Compartido por CodeMirror y el resaltador estático. */
export const DECLS = ["PIPELINE", "STEP", "FLOW", "SOURCE", "SINK", "USE", "INPUT", "OUTPUT"] as const;
export const OPERATIONS = [
  ["FILTER", "WHERE condición;"],
  ["SELECT", "COLUMNS a, b;"],
  ["DERIVE", "nueva = expresión;"],
  ["AGGREGATE", "GROUP_BY a; SUM(x) AS total;"],
  ["JOIN", "TYPE LEFT; ON left.a == right.b;"],
  ["SORT", "BY a DESC;"],
  ["DISTINCT", "COLUMNS a;"],
  ["RENAME", "a AS b;"],
  ["FILL_NULL", "a = 0;"],
  ["DROP_NULLS", "COLUMNS a;"],
] as const;
export const CLAUSES = ["WHERE", "COLUMNS", "GROUP_BY", "BY", "ON", "TYPE", "AS", "ASC", "DESC", "LEFT", "RIGHT", "INNER", "FULL", "VERIFY", "MANY_TO_ONE"];
export const LOGIC = ["AND", "OR", "NOT", "IS"];
export const ATOMS = ["TRUE", "FALSE", "NULL"];
export const TYPES = ["TABLE", "INT", "DECIMAL", "STRING", "BOOL", "DATE", "DATETIME"];
export const CONNECTORS = ["CSV", "PARQUET", "SQLITE", "DUCKDB"];
export const FUNCS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "SAFE_DIVIDE", "LOWER", "UPPER", "TRIM"];


/**
 * Aridad que exige etl_dsl/validation.py (E_ARITY). `max: null` = sin límite superior.
 * tests/suggestions.test.mjs la contrasta con el compilador real.
 */
export type Arity = { min: number; max: number | null };
export const SCALAR_ARITY: Record<string, Arity> = {
  COALESCE: { min: 2, max: null },
  NULLIF: { min: 2, max: 2 },
  SAFE_DIVIDE: { min: 2, max: 2 },
  LOWER: { min: 1, max: 1 },
  UPPER: { min: 1, max: 1 },
  TRIM: { min: 1, max: 1 },
};
export const AGGREGATE_ARITY: Record<string, Arity> = {
  COUNT: { min: 0, max: 1 },
  SUM: { min: 1, max: 1 },
  AVG: { min: 1, max: 1 },
  MIN: { min: 1, max: 1 },
  MAX: { min: 1, max: 1 },
};

/**
 * Conectores y opciones que acepta el backend (`_connector` en etl_dsl/backend.py): valores de cadena salvo
 * `header` (TRUE/FALSE). SQLITE solo lee; `mode` de DUCKDB solo existe en SINK. Contrastado en tests/suggestions.test.mjs.
 */
export type ConnectorOption = { name: string; required: boolean; value: string; sinkOnly?: boolean };
export const CONNECTOR_SPECS: Record<string, { sink: boolean; options: ConnectorOption[] }> = {
  CSV: {
    sink: true,
    options: [
      { name: "file", required: true, value: "ruta de archivo" },
      { name: "header", required: false, value: "TRUE o FALSE" },
      { name: "delimiter", required: false, value: "un carácter" },
      { name: "nullstr", required: false, value: "texto que representa NULL" },
    ],
  },
  PARQUET: { sink: true, options: [{ name: "file", required: true, value: "ruta de archivo" }] },
  DUCKDB: {
    sink: true,
    options: [
      { name: "file", required: true, value: "ruta de archivo" },
      { name: "table", required: true, value: "nombre de tabla" },
      { name: "schema", required: false, value: "esquema de la base" },
      { name: "mode", required: false, value: '"error", "replace" o "append"', sinkOnly: true },
    ],
  },
  SQLITE: {
    sink: false,
    options: [
      { name: "file", required: true, value: "ruta de archivo" },
      { name: "table", required: true, value: "nombre de tabla" },
    ],
  },
};
