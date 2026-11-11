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

