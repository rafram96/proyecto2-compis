import { useEffect, useMemo, useState } from "react";
import raw from "../evaluation/generated.json";
import { DispersionChart } from "../evaluation/DispersionChart";
import {
  type Cell,
  type Selection,
  type Structure,
  MANUAL,
  OBLIGATIONS,
  REFERENCE,
  STATIC_PROOF,
  applicable,
  catalog,
  ms,
  normalize,
  parseSelection,
  ratio,
  reading,
  rowsFor,
  rowsLabel,
  serializeSelection,
  transforms,
} from "../evaluation/model";
import { useContentFocus } from "./contentNavigation";

const data = raw as unknown as Omit<typeof raw, "cells" | "structure"> & { cells: Cell[]; structure: Structure[] };
const campaign = data.campaign;
const cat = catalog(data);
const workloadById = Object.fromEntries(data.workloads.map((w) => [w.id, w]));
const SECTIONS = [
  ["proposito", "Qué se midió"],
  ["campana", "Campaña y entorno"],
  ["equivalencia", "Equivalencia previa"],
  ["resultados", "Tiempos"],
  ["estructura", "Evidencia estructural"],
  ["errores", "Corpus de errores"],
  ["expresividad", "Expresividad"],
  ["limites", "Límites"],
  ["reproduccion", "Reproducción"],
  ["descargas", "Descargas"],
] as const;
const SCENARIO_TEXT: Record<string, string> = {
  normal: "collect() habitual en las salidas y en las validaciones internas, engine=auto.",
  final_flags_none:
    "QueryOptFlags.none() solo en las materializaciones finales. Contratos, snapshots y anti join C4 conservan las opciones habituales; type_check y type_coercion siguen activos. No es «Polars sin optimización».",
};
const PRESETS: { label: string; note: string; search: string }[] = [
  {
    label: "Mejora observada",
    note: "join · 1 000 000 filas · normal",
    search: "?fase=ejecucion&workload=join&filas=1000000&escenario=normal",
  },
  {
    label: "Sin mejora clara",
    note: "rangos · 1 000 000 filas · normal",
    search: "?fase=ejecucion&workload=rangos&filas=1000000&escenario=normal",
  },
  {
    label: "Abstención de O3",
    note: "control_join · 1 000 000 filas · normal",
    search: "?fase=ejecucion&workload=control_join&filas=1000000&escenario=normal",
  },
  {
    label: "Coste de compilar",
    note: "combinado · compilación",
    search: "?fase=compilacion&workload=combinado",
  },
];
const lima = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "long", timeStyle: "short" });
const utc = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", dateStyle: "long", timeStyle: "medium" });
const bytes = (n: number) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`;

const sources = data.sources;
const list = (paths: string[]) => paths.map((p, i) => (
  <span key={p}>{i ? ", " : ""}<code>{p}</code></span>
));
/** Conclusión calculada por gen_evaluation.py; --check falla si deja de ser cierta. */
function SourceMatch() {
  if (sources.status === "mismatch")
    return (
      <>
        <strong>Las fuentes de esta publicación difieren de las medidas</strong>:{" "}
        {list([...sources.different, ...sources.missing])}
        {sources.missing.length ? ` (ausentes: ${sources.missing.length})` : ""}. Las cifras corresponden al código de la
        revisión medida, no al que publica esta página.
      </>
    );
  return (
    <>
      Las fuentes del compilador, del arnés y de los programas medidos ({sources.recorded} archivos) coinciden byte a byte
      con las del código que publica esta página.
      {sources.added.length > 0 && <> Después se añadió {list(sources.added)}, que no existía al medir.</>}
    </>
  );
}

function readUrl() {
  return parseSelection(location.search, cat);
}

export default function EvaluationPage() {
  const heading = useContentFocus();
  const [state, setState] = useState(readUrl);
  const selection = state.selection;
  useEffect(() => {
    document.title = "Evaluación · Stream";
    // Atrás/adelante entre selecciones guardadas con pushState.
    const restore = () => location.pathname === "/evaluacion" && setState(readUrl());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const update = (next: Selection) => {
    next = { ...next, configurations: normalize(next.configurations, cat, next.phase) };
    history.replaceState(history.state, "", "/evaluacion" + serializeSelection(next, cat) + location.hash);
    setState({ selection: next, ignored: [] });
  };
  const preset = (search: string) => {
    const next = parseSelection(search, cat).selection;
    history.pushState(null, "", "/evaluacion" + serializeSelection(next, cat));
    setState({ selection: next, ignored: [] });
    document.getElementById("tabla-resultados")?.focus();
  };
  const result = useMemo(() => {
    try {
      return rowsFor(data.cells, selection, cat);
    } catch {
      return null;
    }
  }, [selection]);
  const workload = workloadById[selection.workload];
  const cellLabel =
    selection.phase === "compile"
      ? `Compilación de ${selection.workload}, independiente del tamaño y del escenario`
      : `Ejecución de ${selection.workload}, ${rowsLabel(selection.size)} filas izquierdas, escenario ${selection.scenario}`;
  const allowed = applicable(cat, selection.phase);
  const structure = data.structure.filter((s) => s.workload === selection.workload);
  const python = campaign.environment.python.split(" ")[0];

  return (
    <main className="content-page eval-page" id="contenido">
      <div className="docs-layout eval-layout">
        <nav className="docs-nav" aria-label="Secciones de la evaluación">
          <a href="#proposito" aria-current="page">
            Evaluación C5
          </a>
          {SECTIONS.slice(1).map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="eval-main">
          <header className="content-heading">
            <h1 ref={heading} tabIndex={-1}>
              Evaluación del compilador
            </h1>
            <p>
              Evidencia de una campaña histórica ya medida: tiempos con su dispersión, cambios en la IR, errores
              detectados y artefactos descargables para auditarla.
            </p>
          </header>
          <p className="content-note eval-banner" role="note">
            <strong>Campaña histórica, no una medición en vivo.</strong> Se midió el {lima.format(new Date(campaign.started_utc))}{" "}
            (hora de Lima) sobre la revisión <code>{campaign.revision.slice(0, 7)}</code>. <SourceMatch /> La máquina, el entorno y
            la fecha son los de la campaña; no mide el programa abierto en Studio y consultarla no ejecuta nada.
          </p>

          <section aria-labelledby="proposito" className="eval-section">
            <h2 id="proposito" tabIndex={-1}>Qué se midió</h2>
            <p>
              C5 compara el mismo programa compilado sin pases (<strong>O0</strong>), con cada pase aislado, con los cinco pases
              predeterminados (<strong>default</strong>) y con una versión <strong>manual</strong> escrita directamente en Polars
              que conserva los mismos contratos. Ocho programas sintéticos: cuatro ofrecen oportunidades reales de
              optimización y cuatro son controles donde un pase debe abstenerse o no tiene nada que hacer.
            </p>
            <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
              <table>
                <caption>Programas medidos y qué pases aislados transforman su IR</caption>
                <thead>
                  <tr>
                    <th scope="col">Programa</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Qué prueba</th>
                    <th scope="col">Pases que lo transforman</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workloads.map((w) => (
                    <tr key={w.id}>
                      <th scope="row"><code>{w.id}</code></th>
                      <td>{w.role === "control" ? "Control" : "Oportunidad"}</td>
                      <td>{w.purpose}</td>
                      <td>{w.expected.length ? w.expected.join(", ") : "Ninguno (abstención esperada)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Hay dos fases con intervalos distintos. <strong>Compilación</strong>: {campaign.compile_scope}; excluye{" "}
              {campaign.compile_excludes}. <strong>Ejecución</strong>: {campaign.execution_scope}; excluye{" "}
              {campaign.execution_excludes}. Los datos son residentes en memoria: no hay IO de conectores ni SINK.
            </p>
          </section>

          <section aria-labelledby="campana" className="eval-section">
            <h2 id="campana" tabIndex={-1}>Campaña y entorno</h2>
            <dl className="eval-facts">
              <div><dt>Inicio y fin (UTC)</dt><dd>{utc.format(new Date(campaign.started_utc))} – {utc.format(new Date(campaign.finished_utc))}</dd></div>
              <div><dt>Revisión medida</dt><dd><code className="eval-hash">{campaign.revision}</code></dd></div>
              <div data-sources={sources.status}>
                <dt>Fuentes frente a esta publicación</dt>
                <dd>
                  {sources.groups.map((g, i) => (
                    <span key={g.id}>{i ? " · " : ""}{g.label}: {g.matching} de {g.recorded} coinciden</span>
                  ))}
                  {sources.added.length > 0 && <>. Añadidos después: {list(sources.added)}</>}. Regla del arnés: {sources.rule}.
                </dd>
              </div>
              <div><dt>Estado Git al medir</dt><dd>Solo cambios ajenos: <code>{campaign.git_status.replace("\n", " · ")}</code></dd></div>
              <div><dt>Modo</dt><dd><code>{campaign.mode}</code>, estado <code>{campaign.status}</code></dd></div>
              <div><dt>Filas izquierdas</dt><dd>{campaign.sizes.map(rowsLabel).join(" · ")} (no son bytes ni filas finales)</dd></div>
              <div><dt>Semilla</dt><dd>{campaign.seed}</dd></div>
              <div><dt>Repeticiones</dt><dd>{campaign.warmups} calentamientos descartados y {campaign.repetitions} repeticiones por celda</dd></div>
              <div><dt>Hilos Polars</dt><dd>{campaign.environment.polars_threads}</dd></div>
              <div><dt>Software</dt><dd>Python {python}, Polars {campaign.environment.polars}, Lark {campaign.environment.lark}, contrato de análisis {campaign.environment.contract_version}</dd></div>
              <div><dt>Máquina</dt><dd>{campaign.environment.cpu}, {campaign.environment.logical_cpu_count} CPU lógicas, {campaign.environment.memory_bytes / 2 ** 30} GiB, {campaign.environment.platform}</dd></div>
              <div><dt>Reloj y unidad</dt><dd><code>{campaign.clock}</code>, valores en {campaign.unit}</dd></div>
              <div><dt>Orden</dt><dd>{campaign.order}</dd></div>
              <div><dt>Cachés</dt><dd>{campaign.cache_policy}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="equivalencia" className="eval-section">
            <h2 id="equivalencia" tabIndex={-1}>Equivalencia antes de medir</h2>
            <p>
              Ninguna configuración se cronometra si no produce exactamente el mismo resultado que O0. Se comparan puertos de
              salida, nombres y orden de columnas, dtypes, dimensiones, NULL y valores exactos (NULL distinto de NaN).
              Hubo <strong>{campaign.equivalence.total}</strong> comprobaciones previas registradas, y cada ejecución
              cronometrada se volvió a comparar después de medirla, fuera del intervalo.
            </p>
            <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
              <table>
                <caption>Comprobaciones previas de equivalencia por caso (todas válidas)</caption>
                <thead><tr><th scope="col">Caso</th><th scope="col">Comprobaciones</th></tr></thead>
                <tbody>
                  {Object.entries(campaign.equivalence.by_case).map(([name, count]) => (
                    <tr key={name}><th scope="row"><code>{name}</code></th><td>{count}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Cada fila cubre los ocho programas, las {campaign.equivalence.configurations.length} configuraciones (incluida manual) y
              ambos escenarios. El orden de filas se exige igual salvo en <code>control_sin_garantia</code>, que no lo garantiza: allí se
              ordenan todas las columnas sin eliminar duplicados.
            </p>
          </section>

          <section aria-labelledby="resultados" className="eval-section eval-results">
            <h2 id="resultados" tabIndex={-1}>Tiempos y dispersión</h2>
            <p>
              Elige una celda comparable. La razón es <strong>mediana(O0) / mediana(configuración)</strong> dentro de esa misma
              celda: mayor que 1 indica menos tiempo; menor que 1, más. No se mezclan tamaños, escenarios ni fases, y no se
              promedian razones entre programas.
            </p>
            <div className="eval-presets" role="group" aria-label="Casos para comparar">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" className="ui-btn" onClick={() => preset(p.search)}>
                  <strong>{p.label}</strong>
                  <span>{p.note}</span>
                </button>
              ))}
            </div>
            {state.ignored.length > 0 && (
              <p className="eval-warning" role="status">
                Se ignoraron parámetros de la dirección no válidos ({state.ignored.join(", ")}); se muestran los valores
                predeterminados para ellos.
              </p>
            )}
            <form className="eval-filters" onSubmit={(e) => e.preventDefault()} aria-label="Selección de resultados">
              <fieldset>
                <legend>Fase</legend>
                {(["execute", "compile"] as const).map((phase) => (
                  <label key={phase} className="eval-choice">
                    <input
                      type="radio"
                      name="fase"
                      checked={selection.phase === phase}
                      onChange={() => update({ ...selection, phase, configurations: [...applicable(cat, phase)] })}
                    />
                    {phase === "execute" ? "Ejecución" : "Compilación"}
                  </label>
                ))}
              </fieldset>
              <label className="eval-select">
                Programa
                <select
                  value={selection.workload}
                  onChange={(e) => update({ ...selection, workload: e.target.value })}
                >
                  {data.workloads.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.id} ({w.role === "control" ? "control" : "oportunidad"})
                    </option>
                  ))}
                </select>
              </label>
              {selection.phase === "execute" ? (
                <>
                  <fieldset>
                    <legend>Filas izquierdas</legend>
                    {campaign.sizes.map((size) => (
                      <label key={size} className="eval-choice">
                        <input
                          type="radio"
                          name="filas"
                          checked={selection.size === size}
                          onChange={() => update({ ...selection, size })}
                        />
                        {rowsLabel(size)}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset>
                    <legend>Escenario del motor</legend>
                    {campaign.scenarios.map((scenario) => (
                      <label key={scenario} className="eval-choice">
                        <input
                          type="radio"
                          name="escenario"
                          checked={selection.scenario === scenario}
                          onChange={() => update({ ...selection, scenario })}
                        />
                        <code>{scenario}</code>
                      </label>
                    ))}
                  </fieldset>
                </>
              ) : (
                <p className="eval-filter-note">
                  La compilación no depende de los datos: se mide una vez por programa y configuración (<code>size=0</code>,{" "}
                  <code>not_applicable</code>). El baseline manual no se compila, por eso no aparece.
                </p>
              )}
              <fieldset className="eval-configs">
                <legend>Configuraciones</legend>
                {allowed.map((name) => (
                  <label key={name} className="eval-choice">
                    <input
                      type="checkbox"
                      checked={selection.configurations.includes(name)}
                      disabled={name === REFERENCE}
                      onChange={(e) =>
                        update({
                          ...selection,
                          configurations: e.target.checked
                            ? [...selection.configurations, name]
                            : selection.configurations.filter((c) => c !== name),
                        })
                      }
                    />
                    <code>{name}</code>
                    {name === REFERENCE && <span className="eval-muted"> (referencia, siempre visible)</span>}
                  </label>
                ))}
              </fieldset>
            </form>
            <p className="eval-context" aria-live="polite">
              <strong>{workload.title}:</strong> {workload.purpose}{" "}
              {selection.phase === "execute" ? (
                <>
                  <strong>Escenario <code>{selection.scenario}</code>:</strong> {SCENARIO_TEXT[selection.scenario]}
                </>
              ) : (
                <>Los pases añaden análisis: compilar con más pases puede costar más.</>
              )}
            </p>
            {result ? (
              <>
                <div className="reference-table eval-table" id="tabla-resultados" tabIndex={0} role="region" aria-label="Resultados de la celda seleccionada, desplazable">
                  <table>
                    <caption>
                      {cellLabel}. Tiempos en ms redondeados a 4 decimales; valores exactos en summary.csv.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Configuración</th>
                        <th scope="col">Pases</th>
                        <th scope="col">N</th>
                        <th scope="col">Mediana (ms)</th>
                        <th scope="col">P25 (ms)</th>
                        <th scope="col">P75 (ms)</th>
                        <th scope="col">IQR (ms)</th>
                        <th scope="col">Mín.–máx. (ms)</th>
                        <th scope="col">O0 / config.</th>
                        {selection.phase === "execute" && <th scope="col">Transforma la IR</th>}
                        <th scope="col">Lectura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => {
                        const changed = transforms(data.structure, row.workload, row.configuration);
                        const read = reading(row, result.reference, changed);
                        return (
                          <tr key={row.configuration} data-config={row.configuration}>
                            <th scope="row"><code>{row.configuration}</code></th>
                            <td>{row.configuration === MANUAL ? "Polars manual" : row.passes.join(", ") || "ninguno"}</td>
                            <td>{row.n}</td>
                            <td data-value={row.median}>{ms(row.median)}</td>
                            <td data-value={row.p25}>{ms(row.p25)}</td>
                            <td data-value={row.p75}>{ms(row.p75)}</td>
                            <td data-value={row.iqr}>{ms(row.iqr)}</td>
                            <td>{ms(row.min)}–{ms(row.max)}</td>
                            <td data-value={row.ratio}>{ratio(row.ratio)}</td>
                            {selection.phase === "execute" && (
                              <td>{changed === null ? "No aplica" : changed ? "Sí" : "No"}</td>
                            )}
                            <td data-reading={read.key}>{read.text}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="eval-muted eval-rule">
                  <strong>Regla de lectura</strong> (descriptiva, no es una prueba estadística): si la diferencia de medianas no
                  supera el mayor IQR de las dos filas, se marca como no concluyente. En ejecución, una configuración que no
                  cambia la IR se marca «sin reescritura» aunque su mediana varíe.
                </p>
                <DispersionChart rows={result.rows} caption={cellLabel} />
              </>
            ) : (
              <p className="eval-warning" role="alert">
                La evidencia publicada no contiene esta celda completa; no se muestran valores aproximados.
              </p>
            )}
          </section>

          <section aria-labelledby="estructura" className="eval-section">
            <h2 id="estructura" tabIndex={-1}>Evidencia estructural de {selection.workload}</h2>
            <p>
              Cambios en la IR obtenidos fuera del cronómetro. Reducir nodos y reducir tiempo son medidas distintas: un pase
              puede cambiar un operador sin eliminar nodos, y eliminar nodos no garantiza menos tiempo.
            </p>
            <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
              <table>
                <caption>IR original y optimizada de {selection.workload} por configuración (añadir hechos no cuenta como cambio)</caption>
                <thead>
                  <tr>
                    <th scope="col">Configuración</th>
                    <th scope="col">Nodos antes → después</th>
                    <th scope="col">Cambia</th>
                    <th scope="col">Eliminados</th>
                    <th scope="col">Modificados</th>
                    <th scope="col">Pruebas rangos / joins</th>
                  </tr>
                </thead>
                <tbody>
                  {structure.map((s) => (
                    <tr key={s.configuration}>
                      <th scope="row"><code>{s.configuration}</code></th>
                      <td>{s.nodes_before} → {s.nodes_after}</td>
                      <td>{s.changed ? "Sí" : "No"}</td>
                      <td>{s.removed.join(", ") || "—"}</td>
                      <td>{s.modified.join(", ") || "—"}</td>
                      <td>{s.range_rewrites.length} / {s.join_rewrites.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <StructuralProofs entry={structure.find((s) => s.configuration === "default")!} selection={selection} />
          </section>

          <section aria-labelledby="errores" className="eval-section">
            <h2 id="errores" tabIndex={-1}>Corpus de errores</h2>
            <p>
              Separado de los tiempos: ningún fallo se cronometra. {campaign.contract_checks} comprobaciones exigen un código
              de error concreto y todas lo observaron.
            </p>
            <ErrorTables />
          </section>

          <section aria-labelledby="expresividad" className="eval-section">
            <h2 id="expresividad" tabIndex={-1}>Expresividad descriptiva</h2>
            <p>
              LOC = líneas no vacías y no comentadas de los archivos reales, sin normalizar formato. La función manual usa
              helpers compartidos (entradas, salida y SUM SQL) que se cuentan aparte una sola vez. Es una descripción de
              tamaño: <strong>no demuestra legibilidad ni usabilidad</strong>.
            </p>
            <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
              <table>
                <caption>Tamaño de cada programa DSL y de su baseline Polars manual</caption>
                <thead>
                  <tr>
                    <th scope="col">Programa</th>
                    <th scope="col">LOC DSL</th>
                    <th scope="col">LOC función Polars</th>
                    <th scope="col">LOC helpers compartidos</th>
                    <th scope="col">Nodos IR originales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workloads.map((w) => (
                    <tr key={w.id}>
                      <th scope="row"><code>{w.id}</code></th>
                      <td>{w.expressivity.dsl_nonblank_noncomment_lines}</td>
                      <td>{w.expressivity.manual_function_lines}</td>
                      <td>{w.expressivity.manual_shared_helper_lines} (comunes a los ocho)</td>
                      <td>{w.expressivity.dsl_nodes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="limites" className="eval-section">
            <h2 id="limites" tabIndex={-1}>Límites de interpretación</h2>
            <ul className="eval-list">
              <li>Una máquina, ocho programas sintéticos y una semilla: las cifras describen esta campaña, no garantizan rendimiento en otros casos.</li>
              <li>Sin IO de conectores, SINK, memoria pico, energía ni arranque en frío. Los tamaños son filas izquierdas de entrada.</li>
              <li>La ejecución incluye contratos y todas las obligaciones C4; el baseline manual también las conserva y no es una cota inferior experta.</li>
              <li><code>final_flags_none</code> solo cambia las materializaciones finales; cada escenario se compara con su propio O0.</li>
              <li>Una diferencia pequeña frente a la dispersión no demuestra una mejora ni una regresión; no se calcula significancia.</li>
              <li>Una variación de tiempo en una configuración que no transforma la IR no se atribuye al pase.</li>
              <li>Las optimizaciones del motor pueden absorber las de los pases; caches del sistema, GC y ruido térmico siguen activos.</li>
              <li>La compilación con pases cuesta más análisis; ese coste no se amortiza dentro del tiempo de ejecución.</li>
            </ul>
          </section>

          <section aria-labelledby="reproduccion" className="eval-section">
            <h2 id="reproduccion" tabIndex={-1}>Reproducción</h2>
            <p>
              Desde la raíz del repositorio, con las versiones de <code>requirements.txt</code>. Una nueva campaña produce otros
              nanosegundos; se reproducen datos, programas, garantías, opciones y protocolo. El destino debe ser nuevo.
              {sources.status === "mismatch" ? (
                <>
                  Para medir el mismo código, sitúa primero un checkout en la revisión medida (
                  <code>git switch --detach {campaign.revision.slice(0, 7)}</code>); este código difiere en las fuentes listadas arriba.
                </>
              ) : (
                <>
                  Las fuentes registradas coinciden con este código, así que medirlo aquí usa el mismo compilador, arnés y
                  programas que la revisión <code>{campaign.revision.slice(0, 7)}</code>; la máquina y el entorno serán los tuyos.
                </>
              )}
            </p>
            <pre className="eval-code" tabIndex={0} aria-label="Comando de verificación, desplazable">
              <code>{`.venv/bin/python -m benchmarks --mode ${campaign.mode} --sizes ${campaign.sizes.join(",")} \\
  --seed ${campaign.seed} --threads ${campaign.environment.polars_threads} --warmups ${campaign.warmups} \\
  --repetitions ${campaign.repetitions} --scenarios ${campaign.scenarios.join(",")} \\
  --output benchmarks/results/reproduccion`}</code>
            </pre>
            <p>Para comprobar esta publicación sin volver a medir:</p>
            <pre className="eval-code" tabIndex={0} aria-label="Comando de reproducción, desplazable">
              <code>{`.venv/bin/python web/scripts/gen_evaluation.py --check
.venv/bin/python -m unittest tests.test_evaluation_evidence`}</code>
            </pre>
          </section>

          <section aria-labelledby="descargas" className="eval-section">
            <h2 id="descargas" tabIndex={-1}>Descargas</h2>
            <p>
              Instantánea pública versionada de la campaña. Los archivos marcados como copia idéntica conservan los bytes del
              original; <code>metadata.public.json</code> es una versión depurada que solo sustituye la ruta local del
              intérprete. <code>manifest.json</code> declara ambos hashes y la procedencia.
            </p>
            <Downloads />
          </section>
        </div>
      </div>
    </main>
  );
}

function StructuralProofs({ entry, selection }: { entry: Structure; selection: Selection }) {
  const joins = entry.join_rewrites;
  const ranges = entry.range_rewrites;
  const observed =
    selection.phase === "execute"
      ? (() => {
          const { rows, reference } = rowsFor(
            data.cells,
            { ...selection, configurations: [REFERENCE, "default"] },
            cat,
          );
          return { row: rows[1], read: reading(rows[1], reference, entry.changed) };
        })()
      : null;
  if (!joins.length && !ranges.length)
    return (
      <p className="content-note">
        Con <code>default</code> no se emitieron pruebas de rangos ni de joins para <code>{entry.workload}</code>.
        {entry.changed ? " Los cambios de la tabla proceden de pases clásicos, que no emiten pruebas." : " Ningún pase transformó operadores: es una abstención comprobada."}
      </p>
    );
  return (
    <div className="eval-proofs">
      {joins.map((j) => (
        <article key={j.node} className="eval-proof">
          <h3>JOIN <code>{j.node}</code>: cuatro cosas distintas</h3>
          <dl>
            <div>
              <dt>Declaración</dt>
              <dd><code>{j.guarantee}</code> en el programa. Por sí sola no elimina nada.</dd>
            </div>
            <div>
              <dt>Prueba estática</dt>
              <dd>
                <ul>{j.static_proof.map((p) => <li key={p}>{STATIC_PROOF[p] ?? p} <code>{p}</code></li>)}</ul>
                Permite reescribir <code>{j.action}</code>: se conserva <code>{j.retained}</code> y no se construyen las columnas de{" "}
                <code>{j.eliminated}</code>.
              </dd>
            </div>
            <div>
              <dt>Obligaciones dinámicas</dt>
              <dd>
                Siguen ejecutándose en cada corrida ({j.verification}):
                <ul>{j.obligations.map((o) => <li key={o}>{OBLIGATIONS[o] ?? o} <code>{o}</code></li>)}</ul>
              </dd>
            </div>
            <div>
              <dt>Mejora temporal observada</dt>
              <dd>
                {observed ? (
                  <>
                    Con default, en la celda seleccionada ({rowsLabel(selection.size)} filas, <code>{selection.scenario}</code>):
                    O0/default = <strong>{ratio(observed.row.ratio)}</strong>, «{observed.read.text}». Es una observación de esta
                    campaña, incluye toda la validación C4 y no se deduce de la prueba.
                  </>
                ) : (
                  <>Elige la fase de ejecución para ver el tiempo observado; la compilación no mide este efecto.</>
                )}
              </dd>
            </div>
          </dl>
        </article>
      ))}
      {ranges.length > 0 && (
        <article className="eval-proof">
          <h3>Reescrituras de rangos (O1) con default</h3>
          <ul className="eval-list">
            {ranges.map((r) => (
              <li key={r.node + r.action}>
                <code>{r.node}</code>: <code>{r.action}</code>, <code>{r.before}</code> → {r.after === null ? "eliminado" : <code>{r.after}</code>}.{" "}
                {r.reason} Hechos usados:{" "}
                {r.facts
                  .map(
                    (f) =>
                      `${f.column} ${f.lower ? (f.lower.inclusive ? "≥ " : "> ") + f.lower.value : ""}${f.lower && f.upper ? " y " : ""}${f.upper ? (f.upper.inclusive ? "≤ " : "< ") + f.upper.value : ""}${f.nullable ? "" : ", sin NULL"}`,
                  )
                  .join("; ")}
                .
              </li>
            ))}
          </ul>
          {observed && (
            <p>
              Tiempo observado con default en la celda seleccionada: O0/default = <strong>{ratio(observed.row.ratio)}</strong>, «
              {observed.read.text}». Una prueba de corrección no implica menos tiempo.
            </p>
          )}
        </article>
      )}
      <p className="eval-studio-link">
        <a href="/studio?vista=ir">Abrir la vista IR de Studio</a> para consultar la evidencia O1/O3 que el
        compilador emite para el documento que tengas abierto. No carga este programa de la campaña: tu documento se
        conserva y solo cambia la vista elegida.
      </p>
    </div>
  );
}

function ErrorTables() {
  const compile = data.errors.filter((e) => e.phase === "compile");
  const runtime = data.errors.filter((e) => e.phase === "runtime");
  const cases = [...new Set(runtime.map((e) => e.case))];
  const workloads = [...new Set(runtime.map((e) => e.workload))];
  return (
    <>
      <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
        <table>
          <caption>Errores estáticos: el compilador rechaza el programa antes de ejecutar</caption>
          <thead>
            <tr>
              <th scope="col">Caso</th>
              <th scope="col">Código exigido = observado</th>
              <th scope="col">Configuraciones</th>
              <th scope="col">Control Polars directo</th>
            </tr>
          </thead>
          <tbody>
            {compile.map((e) => (
              <tr key={e.case}>
                <th scope="row"><code>{e.case}</code></th>
                <td><code>{e.observed}</code></td>
                <td>{e.configurations.length} ({e.configurations.join(", ")})</td>
                <td>Falla {e.plain_polars}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="reference-table" tabIndex={0} role="region" aria-label="Tabla con desplazamiento horizontal">
        <table>
          <caption>
            Errores dinámicos de contratos C4 en {workloads.join(", ")}: cada caso se exige a O0, a cada pase, a default y al
            baseline manual
          </caption>
          <thead>
            <tr>
              <th scope="col">Caso</th>
              <th scope="col">Código exigido = observado</th>
              {workloads.map((w) => <th scope="col" key={w}>{w}</th>)}
            </tr>
          </thead>
          <tbody>
            {cases.map((name) => {
              const rows = runtime.filter((e) => e.case === name);
              return (
                <tr key={name}>
                  <th scope="row"><code>{name}</code></th>
                  <td><code>{rows[0].observed}</code></td>
                  {workloads.map((w) => (
                    <td key={w}>{rows.find((e) => e.workload === w)?.configurations.length ?? 0} configuraciones</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="eval-muted">
        Polars directo, sin estos contratos, no garantiza rechazar esos datos. No se afirma que Python carezca de
        comprobadores estáticos externos.
      </p>
    </>
  );
}

type Check = "idle" | "running" | "ok" | "mismatch" | "unavailable";
function Downloads() {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const base = data.downloads.base;
  const files = [
    ...data.downloads.files,
    {
      path: "manifest.json",
      role: "Manifiesto: campaña, procedencia, archivos autorizados, hashes publicados y originales.",
      bytes: data.downloads.manifest.bytes,
      sha256: data.downloads.manifest.sha256,
      identical_to_original: null,
      original: null,
      redactions: [],
    },
  ];
  const verify = async (path: string, expected: string) => {
    if (!crypto.subtle) return setChecks((c) => ({ ...c, [path]: "unavailable" }));
    setChecks((c) => ({ ...c, [path]: "running" }));
    try {
      const response = await fetch(base + path, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); // taste-skill-ignore: SHA-256 hexadecimal
      setChecks((c) => ({ ...c, [path]: hex === expected ? "ok" : "mismatch" }));
    } catch {
      setChecks((c) => ({ ...c, [path]: "unavailable" }));
    }
  };
  const text: Record<Check, string> = {
    idle: "",
    running: "Calculando…",
    ok: "Coincide con el hash publicado",
    mismatch: "No coincide con el hash publicado",
    unavailable: "No se pudo comprobar en este navegador",
  };
  return (
    <ul className="eval-downloads">
      {files.map((file) => {
        const state = checks[file.path] ?? "idle";
        return (
          <li key={file.path} data-file={file.path}>
            <div className="eval-download-head">
              <a href={base + file.path} download>
                {file.path}
              </a>
              <span>{bytes(file.bytes)}</span>
              <span className="eval-badge" data-kind={file.identical_to_original === false ? "redacted" : "copy"}>
                {file.identical_to_original === null
                  ? "Generado al publicar"
                  : file.identical_to_original
                    ? "Copia idéntica"
                    : "Versión depurada"}
              </span>
            </div>
            <p>{file.role}</p>
            <p className="eval-hash-line">
              SHA-256 publicado: <code className="eval-hash">{file.sha256}</code>
            </p>
            {file.original && !file.identical_to_original && (
              <p className="eval-hash-line">
                SHA-256 del original <code>{file.original.path}</code> (no publicado): <code className="eval-hash">{file.original.sha256}</code>
              </p>
            )}
            <div className="eval-verify">
              <button type="button" className="ui-btn" onClick={() => verify(file.path, file.sha256)} disabled={state === "running"}>
                Verificar SHA-256 de {file.path}
              </button>
              <span role="status" data-check={state}>{text[state]}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
