"use strict";

// Ayuda del lenguaje para el editor: se muestra al pasar el mouse sobre una palabra clave,
// una función o un tipo.
// Resume docs/lenguaje.md; si el lenguaje cambia, se actualiza aquí.

const ETL_HELP = {
  // Estructura del programa
  PIPELINE: {
    group: "Declaración",
    text: "Agrupa un flujo de datos con nombre. Un archivo puede tener varios.",
    example: "PIPELINE resumen {\n    FROM CSV(file: \"orders.csv\");\n    TO CSV(file: \"out/copia.csv\");\n}",
  },
  FROM: {
    group: "Forma lineal",
    text: "Primera línea de un pipeline lineal: indica de dónde se leen los datos. El esquema `AS TABLE[...]` es opcional. "
      + "Con `FROM INPUT nombre: TABLE[...]` recibe la tabla de quien use el pipeline.",
    example: "FROM CSV(file: \"orders.csv\") AS TABLE[id: INT, amount: DECIMAL?];",
  },
  TO: {
    group: "Forma lineal",
    text: "Guarda la tabla actual. La cadena continúa después, así que se pueden guardar resultados intermedios. "
      + "El último elemento de un pipeline lineal debe ser un `TO`.",
    example: "TO PARQUET(file: \"out/resumen.parquet\");",
  },
  SOURCE: {
    group: "Declaración (forma de grafo)",
    text: "Lee datos desde un archivo o base de datos. Se conecta con los pasos en `FLOW`.",
    example: "SOURCE ventas = CSV(file: \"orders.csv\");",
  },
  SINK: {
    group: "Declaración (forma de grafo)",
    text: "Guarda el resultado en un archivo o base de datos.",
    example: "SINK resultado = PARQUET(file: \"out/resultado.parquet\");",
  },
  INPUT: {
    group: "Declaración",
    text: "Tabla que recibe el pipeline desde quien lo usa con `USE`. El esquema es obligatorio.",
    example: "INPUT pedidos: TABLE[id: INT, amount: DECIMAL?];",
  },
  OUTPUT: {
    group: "Declaración",
    text: "Tabla que el pipeline devuelve a quien lo usa con `USE`. `TABLE` sin columnas no fija el esquema.",
    example: "OUTPUT limpios: TABLE;",
  },
  STEP: {
    group: "Declaración",
    text: "Le da nombre a una operación para conectarla en `FLOW` (o para nombrarla en la forma lineal).",
    example: "STEP grandes = FILTER { WHERE amount > 100; }",
  },
  USE: {
    group: "Declaración (forma de grafo)",
    text: "Usa otro pipeline del mismo archivo como un paso. Sus `INPUT` y `OUTPUT` se conectan en `FLOW` con `instancia.puerto`.",
    example: "USE limpieza AS limpia;",
  },
  FLOW: {
    group: "Declaración (forma de grafo)",
    text: "Conecta las declaraciones con flechas `->`. Va al final del pipeline y debe ser único.",
    example: "FLOW {\n    ventas -> grandes -> resultado;\n}",
  },
  TABLE: {
    group: "Esquema",
    text: "Describe las columnas de una tabla con su tipo. `?` indica que la columna admite NULL.",
    example: "TABLE[id: INT, amount: DECIMAL?, status: STRING?]",
  },

  // Operaciones
  FILTER: {
    group: "Operación",
    text: "Conserva solo las filas que cumplen la condición. Las filas donde la condición es NULL se descartan.",
    example: "FILTER { WHERE amount > 0 AND status IS NOT NULL; }",
  },
  SELECT: {
    group: "Operación",
    text: "Se queda solo con las columnas indicadas, en ese orden.",
    example: "SELECT { COLUMNS id, amount; }",
  },
  DERIVE: {
    group: "Operación",
    text: "Agrega columnas nuevas calculadas a partir de las existentes.",
    example: "DERIVE { neto = amount * 0.9; etiqueta = UPPER(status); }",
  },
  AGGREGATE: {
    group: "Operación",
    text: "Resume filas: agrupa por las columnas de `GROUP_BY` (opcional) y calcula `COUNT`, `SUM`, `AVG`, `MIN` o `MAX`.",
    example: "AGGREGATE { GROUP_BY status; SUM(amount) AS total; COUNT() AS n; }",
  },
  JOIN: {
    group: "Operación (forma de grafo)",
    text: "Combina dos tablas. Las entradas se conectan en `FLOW` con los puertos `.left` y `.right`; "
      + "cada igualdad de `ON` une una columna `left` con una `right`.",
    example: "STEP unidos = JOIN { TYPE LEFT; ON left.cliente_id == right.id; }",
  },
  SORT: {
    group: "Operación",
    text: "Ordena las filas. `ASC` (de menor a mayor) es el orden por defecto; `DESC` invierte el orden.",
    example: "SORT { BY total DESC, id; }",
  },
  DISTINCT: {
    group: "Operación",
    text: "Se queda con las columnas listadas y elimina las combinaciones repetidas.",
    example: "DISTINCT { COLUMNS cliente_id, fecha; }",
  },
  RENAME: {
    group: "Operación",
    text: "Cambia el nombre de una o más columnas.",
    example: "RENAME { id AS cliente_id; }",
  },
  FILL_NULL: {
    group: "Operación",
    text: "Reemplaza los valores NULL de columnas existentes por un valor fijo.",
    example: "FILL_NULL { amount = 0; status = \"DESCONOCIDO\"; }",
  },
  DROP_NULLS: {
    group: "Operación",
    text: "Elimina las filas que tienen NULL en alguna de las columnas indicadas.",
    example: "DROP_NULLS { COLUMNS amount, status; }",
  },

  // Cláusulas
  WHERE: { group: "Cláusula de FILTER", text: "Condición que deben cumplir las filas que se conservan.", example: "WHERE amount > 0;" },
  COLUMNS: { group: "Cláusula", text: "Lista de columnas de `SELECT`, `DISTINCT` o `DROP_NULLS`.", example: "COLUMNS id, amount;" },
  GROUP_BY: { group: "Cláusula de AGGREGATE", text: "Columnas que forman cada grupo. Si se omite, se resume toda la tabla en una fila.", example: "GROUP_BY cliente_id;" },
  BY: { group: "Cláusula de SORT", text: "Columnas por las que se ordena, cada una con `ASC` o `DESC`.", example: "BY total DESC, id;" },
  ON: { group: "Cláusula de JOIN", text: "Igualdades entre columnas de `left` y de `right`, unidas con `AND`.", example: "ON left.id == right.cliente_id;" },
  TYPE: { group: "Cláusula de JOIN", text: "Tipo de unión: `INNER`, `LEFT`, `RIGHT` o `FULL`.", example: "TYPE LEFT;" },
  AS: { group: "Palabra clave", text: "Da nombre a un resultado (`SUM(x) AS total`), renombra (`a AS b`), anota un esquema o nombra una instancia de `USE`." },
  IS: { group: "Operador", text: "Compara con NULL: `x IS NULL` o `x IS NOT NULL`. Escribir `x == NULL` es un error (`E_NULL_COMPARISON`).", example: "WHERE status IS NOT NULL;" },
  NULL: { group: "Valor", text: "Ausencia de valor. Para preguntar por él se usa `IS NULL` / `IS NOT NULL`, nunca `==`." },
  AND: { group: "Operador lógico", text: "Verdadero si ambas condiciones lo son (lógica de tres valores, como SQL)." },
  OR: { group: "Operador lógico", text: "Verdadero si alguna de las condiciones lo es (lógica de tres valores, como SQL)." },
  NOT: { group: "Operador lógico", text: "Niega una condición. `NOT NULL` sigue siendo NULL." },
  TRUE: { group: "Valor", text: "Valor lógico verdadero." },
  FALSE: { group: "Valor", text: "Valor lógico falso." },
  INNER: { group: "Tipo de JOIN", text: "Solo las filas con pareja en ambas tablas." },
  LEFT: { group: "Tipo de JOIN", text: "Todas las filas de la tabla izquierda; las columnas de la derecha quedan NULL si no hay pareja." },
  RIGHT: { group: "Tipo de JOIN", text: "Todas las filas de la tabla derecha; las de la izquierda quedan NULL si no hay pareja." },
  FULL: { group: "Tipo de JOIN", text: "Todas las filas de ambas tablas, con NULL donde no hay pareja." },
  ASC: { group: "Orden", text: "De menor a mayor (por defecto)." },
  DESC: { group: "Orden", text: "De mayor a menor." },

  // Funciones
  COUNT: { group: "Agregación", signature: "COUNT() · COUNT(expr)", text: "Cantidad de filas, o de valores no NULL de la expresión." },
  SUM: { group: "Agregación", signature: "SUM(expr)", text: "Suma de los valores no NULL." },
  AVG: { group: "Agregación", signature: "AVG(expr)", text: "Promedio de los valores no NULL." },
  MIN: { group: "Agregación", signature: "MIN(expr)", text: "Menor valor." },
  MAX: { group: "Agregación", signature: "MAX(expr)", text: "Mayor valor." },
  COALESCE: { group: "Función", signature: "COALESCE(a, b, …)", text: "Primer valor que no es NULL. Requiere al menos dos argumentos." },
  NULLIF: { group: "Función", signature: "NULLIF(a, b)", text: "NULL si `a == b`; si no, `a`." },
  SAFE_DIVIDE: { group: "Función", signature: "SAFE_DIVIDE(a, b)", text: "`a / b`, pero devuelve NULL cuando `b` es 0 en lugar de fallar." },
  LOWER: { group: "Función", signature: "LOWER(texto)", text: "Texto en minúsculas." },
  UPPER: { group: "Función", signature: "UPPER(texto)", text: "Texto en mayúsculas." },
  TRIM: { group: "Función", signature: "TRIM(texto)", text: "Quita los espacios al inicio y al final." },

  // Tipos
  INT: { group: "Tipo", text: "Número entero." },
  DECIMAL: { group: "Tipo", text: "Número con decimales. También acepta enteros." },
  STRING: { group: "Tipo", text: "Texto." },
  BOOL: { group: "Tipo", text: "Verdadero o falso." },
  DATE: { group: "Tipo", text: "Fecha (sin hora)." },
  DATETIME: { group: "Tipo", text: "Fecha y hora." },

  // Conectores
  CSV: { group: "Conector", signature: "CSV(file, header?, delimiter?, nullstr?)", text: "Archivo de texto separado por comas. `header` es TRUE o FALSE; `delimiter`, un carácter." },
  PARQUET: { group: "Conector", signature: "PARQUET(file)", text: "Archivo columnar Parquet." },
  DUCKDB: { group: "Conector", signature: "DUCKDB(file, table, schema?, mode?)", text: "Tabla de una base DuckDB. Al guardar, `mode` puede ser \"error\", \"replace\" o \"append\"." },
  SQLITE: { group: "Conector", signature: "SQLITE(file, table)", text: "Tabla de una base SQLite. Solo lectura." },
};

// Texto Markdown de la ayuda de una palabra (null si no tiene).
function etlHelpMarkdown(word) {
  const help = ETL_HELP[word];
  if (!help) return null;
  const parts = [`**${help.signature ?? word}** · ${help.group}`, help.text];
  if (help.example) parts.push("```etl\n" + help.example + "\n```");
  return parts.join("\n\n");
}
