import type { ReactNode } from "react";
import { programs, pyBody } from "../data";
import { Code } from "./Code";

const credit = programs["credit_risk.etl"].source.split("\n");
const pick = (re: RegExp) => credit.find((l) => re.test(l))!.trim();
const flow = (() => {
  const start = credit.findIndex((l) => l.includes("raw_orders -> clean.orders"));
  return ["FLOW {", ...credit.slice(start, start + 4), "}"].join("\n");
})();
const lazy = pyBody(programs["ventas.etl"].default.python.out)
  .split("\n")
  .filter((l) => /^\s+t_[34] = /.test(l))
  .map((l) => l.trim())
  .join("\n");

/** El menú de autocompletado del estudio, tal como aparece al escribir «F» después de «=». */
function Completion() {
  const items: [string, string][] = [
    ["FILTER", "operación"],
    ["FILL_NULL", "operación"],
    ["FLOW", "declaración"],
    ["FALSE", ""],
    ["FULL", ""],
  ];
  return (
    <div className="complete">
      <pre className="complete-line">
        <span className="k">STEP</span> <span className="f">limpio</span> = F<span className="caret" />
      </pre>
      <div className="complete-menu">
        <ul>
          {items.map(([label, detail], i) => (
            <li key={label} aria-selected={i === 0}>
              <code>{label}</code>
              <em>{detail}</em>
            </li>
          ))}
        </ul>
        <p className="complete-info">
          <code>WHERE condición;</code>
        </p>
      </div>
    </div>
  );
}

const MODULES: { title: string; body: [string, string]; panel: ReactNode }[] = [
  {
    title: "Tus datos, donde ya están.",
    body: [
      "CSV, Parquet, SQLite y DuckDB sirven como fuente o como destino. Las rutas se resuelven junto al archivo .etl.",
      "DuckDB solo lee y escribe: cada transformación la ejecuta Polars.",
    ],
    panel: (
      <Code
        code={[
          'SOURCE pedidos = CSV(file: "orders.csv");',
          'SOURCE resumen = PARQUET(file: "summary.parquet");',
          'SOURCE clientes = SQLITE(file: "bank.db", table: "clients");',
          'SOURCE ventas = DUCKDB(file: "ventas.duckdb", table: "ventas");',
        ].join("\n")}
      />
    ),
  },
  {
    title: "Diez operaciones, una por paso.",
    body: [
      "FILTER, SELECT, DERIVE, AGGREGATE, JOIN, SORT, DISTINCT, RENAME, FILL_NULL y DROP_NULLS. Cada STEP hace una sola cosa y lleva nombre.",
      "El estudio te las sugiere mientras escribes.",
    ],
    panel: <Completion />,
  },
  {
    title: "El orden lo dice FLOW.",
    body: [
      "Declaras los pasos sueltos y FLOW los une con flechas, también en ramas que se juntan en un JOIN.",
      "Antes de generar nada, el compilador busca ciclos, nodos desconocidos y puertos sin conectar.",
    ],
    panel: <Code code={flow} />,
  },
  {
    title: "Pipelines que se reutilizan.",
    body: [
      "Un PIPELINE con INPUT y OUTPUT tipados es una pieza: otro lo instancia con USE y lo conecta por sus puertos.",
      "Nombres, tipos y nulos de esos contratos se comprueban al ejecutar.",
    ],
    panel: <Code code={[pick(/^\s+INPUT orders/), pick(/^\s+OUTPUT cleaned/), pick(/^\s+USE clean_orders/)].join("\n")} />,
  },
  {
    title: "Nada se calcula hasta el SINK.",
    body: [
      "El Python generado encadena un LazyFrame de Polars. Los datos se leen una vez, al final.",
      "Así Polars suma sus propias optimizaciones a las del compilador.",
    ],
    panel: <Code code={lazy} />,
  },
];

export function Language() {
  return (
    <section className="lang" id="lenguaje" aria-labelledby="lang-t">
      <h2 id="lang-t" data-reveal>
        Un lenguaje que cabe en una hoja.
      </h2>
      {MODULES.map((m) => (
        <article className="module" key={m.title}>
          <div className="module-panel" data-ui data-reveal>
            {m.panel}
          </div>
          <div className="module-text" data-reveal style={{ ["--d" as string]: 1 }}>
            <h3>{m.title}</h3>
            <p>{m.body[0]}</p>
            <p>{m.body[1]}</p>
          </div>
        </article>
      ))}
    </section>
  );
}
