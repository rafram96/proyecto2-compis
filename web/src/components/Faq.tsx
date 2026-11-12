import type { ReactNode } from "react";
import { stats } from "../data";

const BUILT_ON = ["Python", "Lark", "Polars", "DuckDB", "CodeMirror", "Pyodide"];

export function BuiltOn() {
  return (
    <section className="built" aria-label="Tecnologías">
      <p data-reveal>Construido sobre</p>
      <ul data-reveal style={{ ["--d" as string]: 1 }}>
        {BUILT_ON.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

const QA: [string, ReactNode][] = [
  [
    "¿Necesito saber programar?",
    "No para escribir un pipeline: declaras fuentes, pasos y destinos con palabras como FILTER o SORT. El Python aparece solo como salida, por si quieres leerlo o llevarlo a otro proyecto.",
  ],
  [
    "¿Qué pasa si me equivoco?",
    <>
      El compilador se detiene antes de tocar un dato y te dice archivo, línea y columna, con un código como <code>E_NULL_COMPARISON</code>{" "}
      o <code>E_UNKNOWN_NODE</code>. Hay {stats.errorCodes} códigos distintos y todos explican el problema en español.
    </>,
  ],
  [
    "¿Dónde se procesan mis datos?",
    "Compile analiza el código en tu navegador y no lee datasets. Run envía el programa al servicio privado y procesa los datasets autorizados con Polars. También puedes descargar Python y ejecutarlo en tu equipo.",
  ],
  [
    "¿Puedo ver lo que hace el optimizador?",
    <>
      Sí. <code>--format ir</code> imprime el plan antes y después de los pases, <code>-O0</code> los apaga y{" "}
      <code>--pases constantes,filtros</code> elige cuáles y en qué orden.
    </>,
  ],
  [
    "¿Qué formatos lee y escribe?",
    "CSV, Parquet, SQLite y DuckDB, como SOURCE o como SINK. DuckDB se usa solo como conector; las transformaciones las ejecuta Polars.",
  ],
  [
    "¿Cómo lo instalo?",
    <>
      Con Python 3.11 o superior: <code>pip install -r requirements.txt && pip install -e . --no-deps</code>. Después,{" "}
      <code>python main.py --run</code> compila y ejecuta los ejemplos de la carpeta input.
    </>,
  ],
  [
    "¿Cómo compila Studio sin servidor?",
    "Descarga Python compilado a WebAssembly (Pyodide), instala lark y corre el mismo paquete etl_dsl que usarías en la terminal. La primera vez tarda unos segundos; después compila al instante.",
  ],
  [
    "¿Se puede reutilizar un pipeline?",
    "Sí, con USE. Un PIPELINE con INPUT y OUTPUT se instancia dentro de otro y se conecta en FLOW por sus puertos, por ejemplo clean.orders y clean.cleaned.",
  ],
];

export function Faq() {
  return (
    <section className="faq" id="preguntas" aria-labelledby="faq-t">
      <h2 id="faq-t" data-reveal>
        Lo que suelen preguntar
      </h2>
      <div className="faq-list">
        {QA.map(([q, a], i) => (
          <details key={q} name="faq" data-reveal style={{ ["--d" as string]: Math.min(i, 4) }} open={i === 0}>
            <summary>
              {q}
              <span className="plus" aria-hidden="true" />
            </summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <span className="foot-what">Stream, un lenguaje ETL que compila a Polars.</span>
      <nav className="foot-links" aria-label="Pie de página">
        <a href="https://github.com/rafram96/proyecto2-compis" target="_blank" rel="noreferrer">
          Código en GitHub
        </a>
        <a href="https://github.com/rafram96/proyecto2-compis/blob/main/docs/lenguaje.md" target="_blank" rel="noreferrer">
          Referencia del lenguaje
        </a>
        <a href="#origen">Créditos de fotos</a>
      </nav>
      <span className="foot-legal">2026 · UTEC · Sin cookies ni rastreo</span>
    </footer>
  );
}
