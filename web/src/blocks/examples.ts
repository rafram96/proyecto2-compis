import {
  initialBuilder,
  newBlock,
  type Block,
  type Builder,
  type Column,
} from "./model.ts";

type BlockExample = {
  id: string;
  title: string;
  description: string;
  create(): Builder;
};

/** Every example uses the included orders CSV. Factories keep edits and block
 * identities independent when loading the same example more than once. */
function orders(
  name: string,
  blocks: (columns: Column[]) => Block[],
  nullableAmount = false,
): Builder {
  const base = initialBuilder();
  const columns = base.columns.map((column) => ({
    ...column,
    nullable: nullableAmount && column.name === "importe",
  }));
  return {
    ...base,
    name,
    output: `out/${name}.csv`,
    columns,
    blocks: blocks(columns),
  };
}

export const BLOCK_EXAMPLES: readonly BlockExample[] = [
  {
    id: "importes-positivos",
    title: "Filtrar importes positivos",
    description: "Conserva los pedidos cuyo importe es mayor que cero.",
    create: () =>
      orders("importes_positivos", (columns) => [
        {
          ...newBlock("filter", columns),
          column: "importe",
          operator: ">",
          value: "0",
        },
      ]),
  },
  {
    id: "gasto-por-cliente",
    title: "Gasto por cliente",
    description:
      "Filtra importes positivos, suma por cliente y ordena del mayor total al menor.",
    create: () =>
      orders("gasto_por_cliente", (columns) => [
        {
          ...newBlock("filter", columns),
          column: "importe",
          operator: ">",
          value: "0",
        },
        {
          ...newBlock("aggregate", columns),
          column: "importe",
          group: "cliente",
          aggregate: "SUM",
          alias: "total",
        },
        { ...newBlock("sort", columns), column: "total", direction: "DESC" },
      ]),
  },
  {
    id: "calcular-importes",
    title: "Calcular y ordenar importes",
    description:
      "Multiplica el importe por 1.18, elige las columnas de salida y ordena el resultado.",
    create: () =>
      orders("importes_calculados", (columns) => [
        {
          ...newBlock("derive", columns),
          column: "importe",
          operator: "*",
          value: "1.18",
          alias: "importe_ajustado",
        },
        {
          ...newBlock("select", columns),
          columns: ["cliente", "importe_ajustado"],
        },
        {
          ...newBlock("sort", columns),
          column: "importe_ajustado",
          direction: "DESC",
        },
      ]),
  },
  {
    id: "clientes-unicos",
    title: "Clientes únicos",
    description:
      "Elige la columna cliente, quita duplicados y ordena de menor a mayor.",
    create: () =>
      orders("clientes_unicos", (columns) => [
        { ...newBlock("select", columns), columns: ["cliente"] },
        { ...newBlock("distinct", columns), columns: ["cliente"] },
        { ...newBlock("sort", columns), column: "cliente", direction: "ASC" },
      ]),
  },
  {
    id: "limpiar-importes",
    title: "Limpiar importes ausentes",
    description:
      "Admite importes opcionales, retira filas con NULL y conserva los importes positivos.",
    create: () =>
      orders(
        "importes_limpios",
        (columns) => [
          { ...newBlock("drop_nulls", columns), columns: ["importe"] },
          {
            ...newBlock("filter", columns),
            column: "importe",
            operator: ">",
            value: "0",
          },
        ],
        true,
      ),
  },
  {
    id: "contar-pedidos",
    title: "Contar pedidos por cliente",
    description:
      "Agrupa por cliente y cuenta sus pedidos, empezando por quien tiene más.",
    create: () =>
      orders("pedidos_por_cliente", (columns) => [
        {
          ...newBlock("aggregate", columns),
          group: "cliente",
          aggregate: "COUNT",
          alias: "pedidos",
        },
        { ...newBlock("sort", columns), column: "pedidos", direction: "DESC" },
      ]),
  },
];
