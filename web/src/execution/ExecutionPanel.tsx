import { useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "../compiler/types";
import type { Document } from "../workspace/model";
import type { Binding, Capabilities } from "./types";
import { capabilities, cancelRun, getRun, submit } from "./client";
import { activeRun, bindingFields, fieldKey, matchesRequest, requestKey, runRequest, stateLabel } from "./model";
import { receiveRun, session, updateSession, useSession } from "./store";
import { label, pipelines } from "../components/inspectors/model";
import { getWorkspace } from "../workspace/store";
import Results from "./Results";

export default function ExecutionPanel({ doc, analysis, current, reveal = 0 }: { doc: Document; analysis?: AnalysisResult | null; current: boolean; reveal?: number }) {
  const title = useRef<HTMLHeadingElement>(null);
  // ?vista=ejecucion: lleva a esta sección sin cambiar el documento ni iniciar trabajos.
  useEffect(() => {
    if (!reveal) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    title.current?.closest("section")?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    title.current?.focus({ preventScroll: true });
  }, [reveal]);
  const state = useSession(doc.id);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [connection, setConnection] = useState("Consultando servicio…");
  const [attempt, setAttempt] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    let live = true;
    setConnection("Consultando servicio…");
    void capabilities().then((value) => { if (live) { setCaps(value); setConnection("Servicio conectado · demo privada"); } })
      .catch((e: unknown) => { if (live) { setCaps(null); setConnection(e instanceof Error ? e.message : String(e)); } });
    return () => { live = false; };
  }, [attempt]);
  // Al salir de Studio el trabajo continúa. Al volver se consulta de nuevo desde su ID en memoria.
  const run = state.run;
  useEffect(() => {
    if (!run || !activeRun(run)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const poll = async () => {
      if (document.hidden || controller.signal.aborted || inFlight) return;
      inFlight = true;
      try {
        const response = await getRun(run.id, AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        if (!controller.signal.aborted) {
          receiveRun(doc.id, response);
          if (activeRun(response)) timer = setTimeout(poll, 1000);
        }
      } catch (e) {
        if (!controller.signal.aborted) updateSession(doc.id, { error: e instanceof Error ? e.message : String(e) });
      } finally { inFlight = false; }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [doc.id, run?.id, run?.state, attempt]);
  const ast = current && analysis?.artifacts.ast.status === "available" ? analysis.artifacts.ast.data : null;
  const allPipelines = pipelines(ast);
  const selected = allPipelines.some((p) => p.name === state.selection.pipeline) ? state.selection.pipeline : label(allPipelines[0]?.name);
  const fields = bindingFields(ast, selected);
  const bindings: Binding[] = fields.flatMap((f) => {
    const ds = caps?.datasets.find((d) => `${d.id}@${d.version}` === state.selection.datasets[fieldKey(f)]);
    return ds ? [{ pipeline: f.pipeline, declaration: f.declaration, dataset_id: ds.id, version: ds.version }] : [];
  });
  const request = runRequest(doc, selected, bindings);
  const currentKey = requestKey(request);
  const stale = !!run && state.key !== currentKey;
  const canRun = !!caps && current && !!analysis?.ok && !!selected && bindings.length === fields.length && !state.pending && !activeRun(run);
  async function execute() {
    const latest = getWorkspace().workspace.active;
    if (!canRun || latest.id !== doc.id || latest.revision !== doc.revision) return;
    updateSession(doc.id, { pending: true, error: "" });
    try {
      const result = await submit(request);
      if (!matchesRequest(request, result, analysis!.source_hash)) throw new Error("El servicio devolvió una identidad u opciones distintas de la solicitud.");
      updateSession(doc.id, { run: result, key: currentKey });
    } catch (e) { updateSession(doc.id, { error: e instanceof Error ? e.message : String(e) }); }
    finally { updateSession(doc.id, { pending: false }); }
  }
  async function cancel() {
    const latest = session(doc.id).run;
    if (!latest || !activeRun(latest)) return;
    setCancelling(true);
    try { receiveRun(doc.id, await cancelRun(latest.id)); }
    catch (e) { updateSession(doc.id, { error: e instanceof Error ? e.message : String(e) }); }
    finally { setCancelling(false); }
  }
  return <section className="execution-panel" id="resultados" aria-labelledby="results-title" data-ui>
    <div className="execution-heading"><div><h2 id="results-title" ref={title} tabIndex={-1}>Resultados</h2>
      <p>Run envía este programa y sus opciones al servicio Python. Los datasets autorizados ya están en el servidor; compilar sigue siendo local.</p></div>
      <button className="tool-button" onClick={() => setAttempt((n) => n + 1)}>Reconectar</button>
    </div>
    <p className="execution-connection" role="status">{connection}</p>
    {!current && <p>Compila esta revisión para seleccionar pipeline y enlazar sus datos.</p>}
    <div className="execution-bindings">
      <label>Pipeline a ejecutar<select aria-label="Pipeline a ejecutar" value={selected} disabled={!allPipelines.length} onChange={(e) => updateSession(doc.id, { selection: { ...state.selection, pipeline: e.target.value } })}>
        {!selected && <option value="">Compila el documento…</option>}
        {allPipelines.map((p) => <option key={label(p.name)} value={label(p.name)}>{label(p.name)}</option>)}
      </select></label>
      {fields.map((f) => <label key={fieldKey(f)}>{fieldKey(f)} · {f.kind.toUpperCase()}{f.driver ? ` ${f.driver}` : ""}
        <select aria-label={`Dataset para ${fieldKey(f)}`} value={state.selection.datasets[fieldKey(f)] ?? ""} disabled={!caps} onChange={(e) => updateSession(doc.id, { selection: { ...state.selection, datasets: { ...state.selection.datasets, [fieldKey(f)]: e.target.value } } })}>
          <option value="">Elegir dataset autorizado…</option>
          {caps?.datasets.filter((d) => !f.driver || d.driver === f.driver).map((d) => <option key={d.id} value={`${d.id}@${d.version}`} disabled={!d.available}>{d.title} · {d.id}@{d.version}{d.available ? "" : " · sin preparar"}</option>)}
        </select>
      </label>)}
    </div>
    {caps?.datasets.some((d) => !d.available) && <p>Hay datasets sin preparar. En el servidor: <code>python -m service.prepare</code>; después reinicia el servicio y pulsa Reconectar. JOIN incluido está disponible sin preparación.</p>}
    <div className="execution-toolbar">
      <button className="btn sm" disabled={!canRun} onClick={() => void execute()}>{state.pending ? "Enviando…" : "Run"}</button>
      {activeRun(run) && <button className="tool-button" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? "Cancelando…" : "Cancelar ejecución"}</button>}
      {caps && <span>Plazo {caps.limits.timeout_seconds} s · límite RSS muestreado {Math.round(caps.limits.memory_bytes / 1024**2)} MiB RSS · caducidad {caps.limits.ttl_seconds / 60} min</span>}
    </div>
    {state.error && <p role="alert">{state.error}</p>}
    {run && <div className="execution-job" data-run-id={run.id} data-state={run.state} data-current={!stale}>
      <h3 role="status">{stateLabel[run.state]} · {stale ? "resultado anterior" : "revisión actual"}</h3>
      <p>{run.filename} · revisión {run.revision} · {run.pipeline} · pases {run.passes === null ? "predeterminados" : run.passes.length ? run.passes.join(", ") : "O0"}</p>
      {stale && <p className="stale-note">El documento, los pases, el pipeline o los bindings cambiaron. Este trabajo conserva las opciones enviadas; sus datos no pertenecen a la selección actual.</p>}
      <details><summary>Identidad y opciones del trabajo</summary><p>Fuente SHA-256: <code>{run.source_hash}</code></p>
        <ul>{run.bindings.map((b) => <li key={fieldKey(b)}>{fieldKey(b)} → {b.dataset_id}@{b.version} <code>{run.dataset_hashes[b.dataset_id]}</code></li>)}</ul>
      </details>
      {run.diagnostics?.map((d, i) => <p key={i} role="alert"><strong>{d.code}</strong> · {d.phase}: {d.message}{d.span ? ` (${d.span.line}:${d.span.column})` : ""}</p>)}
      {run.metrics?.worker_seconds != null && <p>Proceso: {run.metrics.worker_seconds.toFixed(3)} s desde su arranque hasta detectar su término, incluye recompilación, IO y materialización; excluye cola/HTTP. Pico RSS observado: {Math.round((run.metrics.peak_rss_bytes ?? 0) / 1024**2)} MiB (muestras cada 50 ms).</p>}
      {run.state === "succeeded" && <Results key={run.id} run={run} />}
    </div>}
    {!run && <p className="empty-output">Elige los datos y pulsa Run para obtener filas y archivos reales. Editar y cambiar de vista no inicia trabajos.</p>}
    <p className="execution-footnote">Al navegar, el trabajo continúa y se recupera al volver en esta pestaña. Recargar pierde su referencia local; el servidor conserva los archivos hasta que caduquen. Sin cuentas ni datasets propios.</p>
  </section>;
}
