import { useState } from "react";
import { Logo } from "./Nav";
import { highlight } from "./highlight";

export function Phases() {
  return (
    <section className="phases" id="fases" aria-labelledby="fases-t">
      <div className="phases-grid">
        <div className="phases-head" data-reveal>
          <h2 id="fases-t">Cuatro fases, todas a la vista.</h2>
          <p>Cada paso del compilador tiene su propia pantalla. Nada ocurre dentro de una caja negra.</p>
        </div>

        <article className="stage" data-reveal style={{ ["--d" as string]: 0 }}>
          <div className="tile">
            <div className="frag" data-ui>
              <pre>{highlight(`STEP valid = FILTER {\n  WHERE income > 0;\n}`)}</pre>
            </div>
          </div>
          <h3>Escribes</h3>
          <p>Un DSL en español de pipelines: PIPELINE, STEP, FLOW. Sin cuadernos ni código de pegamento.</p>
        </article>

        <article className="stage" data-reveal style={{ ["--d" as string]: 1 }}>
          <div className="tile">
            <div className="frag" data-ui>
              <pre>
                <span className="err">E_NULL_COMPARISON</span>
                {"\n"}demo/errores.etl:3:27{"\n"}Usa IS NULL / IS NOT NULL{"\n"}para comparar con NULL.
              </pre>
            </div>
          </div>
          <h3>Validas</h3>
          <p>Errores con archivo, línea y columna antes de tocar un solo dato: ciclos, puertos, comparaciones con NULL.</p>
        </article>

        <article className="stage" data-reveal style={{ ["--d" as string]: 2 }}>
          <div className="tile">
            <div className="frag" data-ui>
              <pre>
                {highlight(
                  `%pagadas = FILTER(%ventas) {\n  (amount < 1000)\n  AND (status IS NOT NULL)\n}  // grandes + pagadas\n%ordenadas = SORT(%pagadas)\n%resultado = SINK(%ordenadas)`,
                )}
              </pre>
            </div>
          </div>
          <h3>Optimizas</h3>
          <p>Tres pases (constantes, filtros y muertos) sobre un grafo de pasos. Los activas y desactivas tú.</p>
        </article>

        <article className="stage" data-reveal style={{ ["--d" as string]: 3 }}>
          <div className="tile">
            <div className="frag" data-ui>
              <pre>
                {highlight(
                  `t_1 = rt.step(\n  t_0.filter(\n    (pl.col('amount') < pl.lit(1000))\n    & pl.col('status').is_not_null()\n  )\n)\nt_2 = rt.step(\n  t_1.sort(['amount'],\n    descending=[True])\n)\nt_3 = rt.sink(t_2, 'CSV', …)`,
                )}
              </pre>
            </div>
          </div>
          <h3>Generas</h3>
          <p>Python legible sobre LazyFrame de Polars. Nada se calcula hasta el SINK, así que Polars optimiza también.</p>
        </article>
      </div>
    </section>
  );
}

const CELLS: [string, string][] = [
  ["CSV", "Lee y escribe archivos planos."],
  ["Parquet", "Salida columnar, lista para analítica."],
  ["SQLite", "Tablas de una base local como fuente."],
  ["DuckDB", "Solo como conector; transformar lo hace Polars."],
  ["Polars", "Todo el plan corre como LazyFrame."],
  ["Lark (LALR)", "Gramática formal con errores precisos."],
];

export function Connectors() {
  return (
    <section className="proof" id="conectores" aria-labelledby="con-t">
      <div className="board">
        <div className="cell head" data-reveal>
          <h2 id="con-t">Tus datos, donde ya están.</h2>
          <span>Conectores integrados para leer y escribir sin cambiar de herramienta.</span>
        </div>
        {CELLS.map(([name, desc], i) => (
          <div className="cell" key={name} data-reveal style={{ ["--d" as string]: i % 4 }}>
            <b>{name}</b>
            <span>{desc}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Cta() {
  const [name, setName] = useState("ventas_mensuales");
  const [src, setSrc] = useState<"CSV" | "Parquet">("CSV");
  const [msg, setMsg] = useState("");

  return (
    <section className="cta" id="crear" aria-labelledby="cta-t">
      <div className="cta-copy" data-reveal>
        <h2 id="cta-t">Tu primer cauce.</h2>
        <p>Abrimos el editor con un PIPELINE de ejemplo que ya lleva tu nombre y tu tipo de fuente. Lo compilas y ves el plan en segundos.</p>
      </div>
      <form
        className="dialog"
        data-ui
        data-reveal
        style={{ ["--d" as string]: 1 }}
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(`Listo: el editor se abrirá con «${name || "mi_pipeline"}» sobre ${src}. (Siguiente fase del proyecto.)`);
        }}
      >
        <h3>Nombra tu pipeline</h3>
        <label>
          Nombre
          <input type="text" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w]/g, "_"))} spellCheck={false} autoComplete="off" />
        </label>
        <div>
          <div style={{ fontWeight: 500, fontSize: "0.9375rem", marginBottom: 8 }} id="fuente-l">
            Fuente de datos
          </div>
          <div className="seg" role="group" aria-labelledby="fuente-l">
            {(["CSV", "Parquet"] as const).map((o) => (
              <button type="button" key={o} aria-pressed={src === o} onClick={() => setSrc(o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" type="submit">
          Crear pipeline
        </button>
        <p className="out" role="status">
          {msg}
        </p>
      </form>
    </section>
  );
}

const LETTERS = [
  ["C", "var(--brand-sky)", "92%"],
  ["A", "var(--brand-cyan)", "72%"],
  ["U", "var(--brand-cerulean)", "100%"],
  ["C", "var(--brand-blue)", "80%"],
  ["E", "var(--brand-amber)", "62%"],
] as const;

export function Footer() {
  return (
    <footer className="foot">
      <div className="blocks" aria-label="Cauce" role="img">
        {LETTERS.map(([ch, bg, h], i) => (
          <i key={i} style={{ background: bg, height: h, color: ch === "E" ? "var(--brand-ink)" : "var(--background)" }} aria-hidden="true">
            {ch}
          </i>
        ))}
      </div>
      <div className="foot-cols">
        <ul>
          <li><b>Producto</b></li>
          <li><a href="#optimizador">Optimizador</a></li>
          <li><a href="#fases">Fases</a></li>
          <li><a href="#conectores">Conectores</a></li>
        </ul>
        <ul>
          <li><b>Lenguaje</b></li>
          <li><a href="#fases">PIPELINE y STEP</a></li>
          <li><a href="#fases">FLOW y USE</a></li>
          <li><a href="#optimizador">Pases O4</a></li>
        </ul>
        <ul>
          <li><b>Salida</b></li>
          <li><a href="#fases">Python + Polars</a></li>
          <li><a href="#conectores">Parquet y CSV</a></li>
        </ul>
        <ul>
          <li><b>Proyecto</b></li>
          <li><a href="#crear">Probar</a></li>
        </ul>
        <div className="contact">
          <b>Curso de Compiladores</b>
          <span>UTEC, 2026-2</span>
          <span>Hecho con Lark y Polars.</span>
        </div>
      </div>
      <div className="legal">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="mark" style={{ fontSize: "1rem" }}><Logo /></span> © 2026 Cauce. Proyecto académico.
        </span>
        <a className="btn sm quiet" href="#top">Volver arriba</a>
      </div>
    </footer>
  );
}
