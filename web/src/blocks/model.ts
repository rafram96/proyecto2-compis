export const TYPES = [
  "INT",
  "DECIMAL",
  "STRING",
  "BOOL",
  "DATE",
  "DATETIME",
] as const;
export type Column = {
  name: string;
  type: (typeof TYPES)[number];
  nullable: boolean;
};
export const OPERATIONS = [
  ["filter", "Filtrar filas", "Conserva las filas que cumplen una condición."],
  ["select", "Elegir columnas", "Conserva solo las columnas elegidas."],
  ["derive", "Calcular columna", "Crea una columna numérica a partir de otra."],
  [
    "aggregate",
    "Agrupar y resumir",
    "Calcula un resumen, opcionalmente por grupo.",
  ],
  ["sort", "Ordenar filas", "Ordena por una columna."],
  [
    "distinct",
    "Quitar duplicados",
    "Conserva combinaciones distintas de las columnas elegidas.",
  ],
  [
    "drop_nulls",
    "Quitar filas con NULL",
    "Retira las filas con valores ausentes en las columnas elegidas.",
  ],
] as const;
export type Operation = (typeof OPERATIONS)[number][0];
export type Block = {
  id: string;
  op: Operation;
  column: string;
  columns: string[];
  operator: string;
  value: string;
  alias: string;
  group: string;
  aggregate: string;
  direction: string;
};
export type Builder = {
  name: string;
  file: string;
  output: string;
  columns: Column[];
  blocks: Block[];
};
const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Lexer keywords have priority over NAME, so a syntactically shaped keyword is not a valid name.
const reserved = new Set(
  "PIPELINE INPUT OUTPUT SOURCE SINK USE AS TABLE STEP FLOW FILTER WHERE SELECT COLUMNS DERIVE AGGREGATE GROUP_BY JOIN TYPE ON VERIFY MANY_TO_ONE SORT BY DISTINCT RENAME FILL_NULL DROP_NULLS OR AND NOT IS NULL TRUE FALSE INT DECIMAL STRING BOOL DATE DATETIME INNER LEFT RIGHT FULL ASC DESC COUNT SUM AVG MIN MAX COALESCE NULLIF SAFE_DIVIDE LOWER UPPER TRIM".split(
    " ",
  ),
);
export const validName = (name: string) =>
  identifier.test(name) && !reserved.has(name);
export const numeric = (column?: Column) =>
  column?.type === "INT" || column?.type === "DECIMAL";
const literalNumber = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function newBlock(op: Operation, columns: Column[]): Block {
  const column =
    (op === "derive" || op === "aggregate"
      ? columns.find(numeric)
      : undefined) ?? columns[0];
  return {
    id: crypto.randomUUID(),
    op,
    column: column?.name ?? "",
    columns: columns.map((c) => c.name),
    operator: op === "derive" ? "*" : numeric(column) ? ">" : "==",
    value: op === "derive" ? "1.18" : numeric(column) ? "0" : "",
    alias: op === "derive" ? "calculado" : "total",
    group: "",
    aggregate: "SUM",
    direction: "DESC",
  };
}
export function initialBuilder(): Builder {
  const columns: Column[] = [
    { name: "cliente", type: "INT", nullable: false },
    { name: "importe", type: "DECIMAL", nullable: false },
  ];
  return {
    name: "mi_pipeline",
    file: "joins_pedidos.csv",
    output: "out/resultado.csv",
    columns,
    blocks: [
      {
        ...newBlock("filter", columns),
        column: "importe",
        operator: ">",
        value: "0",
      },
    ],
  };
}
function literal(value: string, column: Column): string | undefined {
  if (numeric(column))
    return literalNumber.test(value) &&
      (column.type !== "INT" || /^-?\d+$/.test(value))
      ? value
      : undefined;
  if (column.type === "BOOL")
    return ["TRUE", "FALSE"].includes(value.toUpperCase())
      ? value.toUpperCase()
      : undefined;
  if (column.type === "STRING") return JSON.stringify(value);
  return undefined;
}
export type BuildResult = {
  source: string;
  errors: string[];
  stages: Column[][];
};
/** Generates a constrained linear DSL; the real compiler remains authoritative.
 * References survive reordering as names; stale columns produce errors, never silent substitutions. */
export function buildPipeline(builder: Builder): BuildResult {
  const errors: string[] = [];
  const stages: Column[][] = [];
  let columns = builder.columns.map((c) => ({ ...c }));
  if (!validName(builder.name))
    errors.push(
      "El nombre del pipeline debe ser un identificador y no una palabra reservada.",
    );
  if (!builder.file.trim() || !builder.output.trim())
    errors.push("Indica los archivos CSV de entrada y salida.");
  if (builder.file.trim() === builder.output.trim())
    errors.push("Usa archivos distintos para entrada y salida.");
  if (!columns.length || columns.length > 32)
    errors.push("Declara entre 1 y 32 columnas de entrada.");
  if (builder.blocks.length > 24)
    errors.push("El constructor admite hasta 24 bloques.");
  const names = new Set<string>();
  columns.forEach((c) => {
    if (!validName(c.name) || names.has(c.name) || !TYPES.includes(c.type))
      errors.push(`Columna inválida o repetida: ${c.name || "sin nombre"}.`);
    names.add(c.name);
  });
  const operations: string[] = [];
  builder.blocks.forEach((block, index) => {
    stages.push(columns.map((c) => ({ ...c })));
    const prefix = `Bloque ${index + 1}`;
    const column = columns.find((c) => c.name === block.column);
    const needsColumn =
      ["filter", "derive", "sort"].includes(block.op) ||
      (block.op === "aggregate" && block.aggregate !== "COUNT");
    if (needsColumn && !column)
      errors.push(
        `${prefix}: la columna «${block.column}» no existe en esta entrada.`,
      );
    const selected = columns.filter((c) => block.columns.includes(c.name));
    if (
      ["select", "distinct", "drop_nulls"].includes(block.op) &&
      (!block.columns.length ||
        block.columns.some((name) => !columns.some((c) => c.name === name)))
    )
      errors.push(`${prefix}: elige al menos una columna disponible.`);
    let operation = "";
    switch (block.op) {
      case "filter": {
        const nullCheck = ["IS NULL", "IS NOT NULL"].includes(block.operator);
        const value = column ? literal(block.value, column) : undefined;
        if (
          !nullCheck &&
          (!["==", "!=", ">", ">=", "<", "<="].includes(block.operator) ||
            value === undefined)
        )
          errors.push(
            `${prefix}: valor u operador incompatible con el tipo. Para ausentes usa IS NULL.`,
          );
        if (
          !nullCheck &&
          column &&
          !numeric(column) &&
          !["==", "!="].includes(block.operator)
        )
          errors.push(
            `${prefix}: este tipo admite igualdad; las comparaciones de orden del constructor son numéricas.`,
          );
        operation = `FILTER { WHERE ${block.column} ${block.operator}${nullCheck ? "" : ` ${value ?? "0"}`}; }`;
        break;
      }
      case "select":
        operation = `SELECT { COLUMNS ${block.columns.join(", ")}; }`;
        columns = selected;
        break;
      case "distinct":
        operation = `DISTINCT { COLUMNS ${block.columns.join(", ")}; }`;
        break;
      case "drop_nulls":
        operation = `DROP_NULLS { COLUMNS ${block.columns.join(", ")}; }`;
        columns = columns.map((c) =>
          block.columns.includes(c.name) ? { ...c, nullable: false } : c,
        );
        break;
      case "sort":
        if (!["ASC", "DESC"].includes(block.direction))
          errors.push(`${prefix}: dirección inválida.`);
        operation = `SORT { BY ${block.column} ${block.direction}; }`;
        break;
      case "derive":
        if (
          !numeric(column) ||
          !literalNumber.test(block.value) ||
          !["+", "-", "*"].includes(block.operator)
        )
          errors.push(
            `${prefix}: el cálculo requiere una columna numérica, una constante y +, − o ×.`,
          );
        if (
          !validName(block.alias) ||
          columns.some((c) => c.name === block.alias)
        )
          errors.push(
            `${prefix}: elige un nombre nuevo para la columna calculada.`,
          );
        operation = `DERIVE { ${block.alias} = ${block.column} ${block.operator} ${block.value}; }`;
        columns = [
          ...columns,
          {
            name: block.alias,
            type:
              column?.type === "DECIMAL" || /[.eE]/.test(block.value)
                ? "DECIMAL"
                : "INT",
            nullable: column?.nullable ?? false,
          },
        ];
        break;
      case "aggregate": {
        const group = columns.find((c) => c.name === block.group);
        if (block.group && !group)
          errors.push(
            `${prefix}: la columna de agrupación no está disponible.`,
          );
        if (!validName(block.alias) || block.alias === block.group)
          errors.push(
            `${prefix}: el resumen necesita un nombre válido distinto del grupo.`,
          );
        if (
          !["SUM", "AVG", "MIN", "MAX", "COUNT"].includes(block.aggregate) ||
          (block.aggregate !== "COUNT" && !numeric(column))
        )
          errors.push(
            `${prefix}: elige COUNT o una columna numérica para el resumen.`,
          );
        operation = `AGGREGATE { ${block.group ? `GROUP_BY ${block.group}; ` : ""}${block.aggregate}(${block.aggregate === "COUNT" ? "" : block.column}) AS ${block.alias}; }`;
        columns = [
          ...(group ? [group] : []),
          {
            name: block.alias,
            type:
              block.aggregate === "COUNT"
                ? "INT"
                : block.aggregate === "AVG"
                  ? "DECIMAL"
                  : (column?.type ?? "DECIMAL"),
            nullable: block.aggregate !== "COUNT",
          },
        ];
        break;
      }
    }
    operations.push(`    STEP paso_${index + 1} = ${operation}`);
  });
  stages.push(columns);
  const source = `// Creado con Stream Blocks. Compile valida el programa completo.\nPIPELINE ${builder.name} {\n    SOURCE datos: TABLE[${builder.columns.map((c) => `${c.name}: ${c.type}${c.nullable ? "?" : ""}`).join(", ")}]\n        = CSV(file: ${JSON.stringify(builder.file)});\n\n${operations.length ? operations.join("\n\n") + "\n\n" : ""}    SINK resultado = CSV(file: ${JSON.stringify(builder.output)});\n\n    FLOW { datos${builder.blocks.length ? " -> " + builder.blocks.map((_, i) => `paso_${i + 1}`).join(" -> ") : ""} -> resultado; }\n}\n`;
  return { source, errors: [...new Set(errors)], stages };
}
