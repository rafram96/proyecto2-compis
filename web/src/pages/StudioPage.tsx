import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { restartCompiler } from "../compiler/client";
import { examples } from "../content";
import PassSelector from "../components/inspectors/PassSelector";
import {
  createDocument,
  fileName,
  INSPECTORS,
  importText,
  MAX_SOURCE,
  pythonDownload,
  sourceSelection,
} from "../workspace/model";
import {
  getWorkspace,
  openDocument,
  removeDraft,
  updateDocument,
  useWorkspace,
} from "../workspace/store";
import { downloadText } from "../workspace/files";
import {
  EXECUTION_SLUG,
  inspectorView,
  parseView,
  serializeView,
  viewLabel,
  viewSlugs,
} from "../workspace/view";
import type { Inspector as InspectorName } from "../workspace/model";
import type { ParsedView, StudioView } from "../workspace/view";
import PanelSplitter, {
  splitStyle,
  usePanelSplit,
} from "../components/PanelSplitter";
import { useCompilation } from "../workspace/useCompilation";
import type { Diagnostic, Span } from "../compiler/types";
const ExecutionPanel = lazy(() => import("../execution/ExecutionPanel"));
const Editor = lazy(() => import("../editor/Editor"));
const Inspector = lazy(() => import("../components/inspectors/Inspector"));

export default function StudioPage() {
  const { workspace, notice, saved } = useWorkspace();
  const doc = workspace.active;
  const { result, current, runtime, busy, error, run } = useCompilation(doc);
  // La vista llega en la URL; el documento y su revisión nunca.
  const [initialView] = useState(() => parseView(location.search));
  const [pane, setPane] = useState<"code" | "inspector">(
    initialView.view?.kind === "inspector" ? "inspector" : "code",
  );
  const [message, setMessage] = useState("");
  const [viewNotice, setViewNotice] = useState("");
  const [reveal, setReveal] = useState(0);
  const [split, commitSplit] = usePanelSplit();
  const panels = useRef<HTMLDivElement>(null);
  const [focusRange, setFocusRange] = useState<{
    from: number;
    to: number;
    token: number;
  }>();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const replaceView = (view: StudioView) =>
    history.replaceState(
      history.state,
      "",
      "/estudio" + serializeView(view) + location.hash,
    );
  // Seleccionar una vista solo cambia el campo inspector: no crea revisión ni recompila.
  const applyView = useCallback(({ view, ignored }: ParsedView) => {
    if (view?.kind === "inspector") {
      if (getWorkspace().workspace.active.inspector !== view.inspector)
        updateDocument({ inspector: view.inspector });
      setPane("inspector");
    } else if (view?.kind === "execution") setReveal((n) => n + 1);
    if (!ignored.length) return setViewNotice("");
    const kept = view
      ? `Se abre ${viewLabel(view)}.`
      : `Se mantiene ${viewLabel(inspectorView(getWorkspace().workspace.active.inspector))}, la vista actual del documento.`;
    setViewNotice(
      `Se ignoró ${ignored.join(", ")} en el enlace. ${kept} Vistas válidas: ${viewSlugs().join(", ")}.`,
    );
    history.replaceState(
      history.state,
      "",
      "/estudio" + (view ? serializeView(view) : "") + location.hash,
    );
  }, []);
  useEffect(() => {
    document.title = "Estudio · Cauce";
    if (initialView.view?.kind !== "execution")
      heading.current?.focus({ preventScroll: true });
    applyView(initialView);
    // Atrás/adelante y enlaces internos con la misma ruta y otra vista.
    const restore = () => {
      if (location.pathname === "/estudio") applyView(parseView(location.search));
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [applyView, initialView]);
  // Si la URL nombra un inspector y el documento activo cambia (ejemplo, borrador),
  // la URL pasa a describir la vista real; sin parámetro, la URL no se toca.
  useEffect(() => {
    const shown = parseView(location.search).view;
    const active = getWorkspace().workspace.active.inspector;
    if (shown?.kind === "inspector" && shown.inspector !== active)
      replaceView(inspectorView(active));
  }, [doc.id, doc.inspector]);
  function selectInspector(inspector: InspectorName) {
    updateDocument({ inspector });
    replaceView(inspectorView(inspector));
    setViewNotice("");
  }
  const analysis = result?.result.analysis;
  const diagnostics = current ? (analysis?.diagnostics ?? []) : [];
  const python = pythonDownload(doc, result);
  const fmt = doc.inspector;
  const origin = result
    ? current
      ? "en vivo"
      : "desactualizado"
    : "sin compilar";
  function selectSource(span: Span) {
    const latest = getWorkspace().workspace.active;
    if (!current || latest.id !== doc.id || latest.revision !== doc.revision)
      return;
    const range = sourceSelection(latest, result, span);
    if (!range) return;
    setPane("code");
    setFocusRange((previous) => ({
      ...range,
      token: (previous?.token ?? 0) + 1,
    }));
  }
  function showDiagnostic(diagnostic: Diagnostic) {
    selectSource(diagnostic.span);
  }
  function openExample(name: string) {
    try {
      const example = examples.find((item) => item.name === name);
      if (!example) throw new Error("Ejemplo no encontrado.");
      openDocument(createDocument(example.name, example.code));
      setMessage(
        "Documento abierto. El anterior está en Borradores anteriores.",
      );
      setPane("code");
    } catch (e) {
      setMessage(String(e instanceof Error ? e.message : e));
    }
  }
  async function importFile(file: File) {
    // Protege una edición que ocurra mientras el navegador está leyendo el archivo.
    const before = getWorkspace().workspace.active;
    try {
      if (file.size > MAX_SOURCE)
        throw new Error("El archivo supera el límite de 128 KiB.");
      const source = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      const now = getWorkspace().workspace.active;
      if (now.id !== before.id || now.revision !== before.revision)
        throw new Error(
          "El documento cambió durante la importación. Selecciona el archivo de nuevo.",
        );
      openDocument(importText(file.name, source));
      setMessage(
        "Archivo importado. El documento anterior está en Borradores anteriores.",
      );
      setPane("code");
    } catch (e) {
      setMessage(
        `No se importó: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return (
    <main className="workspace" id="estudio">
      <div className="workspace-heading">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Estudio
          </h1>
          <p>
            Escribe, compila e inspecciona. Todo el análisis ocurre en tu
            navegador.
          </p>
        </div>
        <p className="workspace-limit">
          Compilación local · ejecución en servicio privado
        </p>
      </div>
      <div className="workbench" data-ui>
        <div className="document-bar">
          <label className="document-name">
            Documento
            <input
              aria-label="Nombre del documento"
              maxLength={100}
              value={doc.name}
              onChange={(e) =>
                updateDocument({
                  name:
                    e.target.value.replace(/[\\/\u0000-\u001f]/g, "_") ||
                    "programa.etl",
                })
              }
            />
          </label>
          <span className="revision">Revisión {doc.revision}</span>
          <div className="document-actions">
            <a
              className="tool-button"
              href={`/estudio?vista=${EXECUTION_SLUG}`}
              onClick={(event) => {
                event.preventDefault();
                replaceView({ kind: "execution" });
                setViewNotice("");
                setReveal((n) => n + 1);
              }}
            >
              Ejecutar y resultados
            </a>
            <button
              className="tool-button"
              onClick={() => input.current?.click()}
            >
              Importar .etl
            </button>
            <input
              hidden
              ref={input}
              type="file"
              accept=".etl,text/plain"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <button
              className="tool-button"
              onClick={() => downloadText(fileName(doc.name), doc.source)}
            >
              Descargar .etl
            </button>
            <button
              className="tool-button"
              disabled={!python}
              onClick={() => {
                if (python)
                  downloadText(
                    python.name,
                    python.text,
                    "text/x-python;charset=utf-8",
                  );
              }}
              title={
                python
                  ? `Python de la revisión ${doc.revision}`
                  : "Compila esta revisión para descargar Python"
              }
            >
              Descargar Python
            </button>
            <button
              className="btn sm"
              onClick={run}
              disabled={busy}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              {busy
                ? runtime.status === "loading"
                  ? "Cargando…"
                  : "Compilando…"
                : "Compilar"}
            </button>
          </div>
        </div>
        <div className="workspace-options">
          <label>
            Abrir ejemplo
            <select
              aria-label="Abrir ejemplo"
              value=""
              onChange={(e) => openExample(e.target.value)}
            >
              <option value="" disabled>
                Elegir una copia…
              </option>
              {examples.map((example) => (
                <option key={example.slug} value={example.name}>
                  {example.name}
                  {example.expectation.ok ? "" : " · ejercicio inválido"}
                </option>
              ))}
            </select>
          </label>
          <PassSelector
            passes={doc.passes}
            onChange={(passes) => updateDocument({ passes })}
          />
          <span className="save-status" role="status" data-saved={saved}>
            {notice}
          </span>
        </div>
        <div className="mobile-panes" aria-label="Panel visible">
          <button
            aria-pressed={pane === "code"}
            onClick={() => setPane("code")}
          >
            Código
          </button>
          <button
            aria-pressed={pane === "inspector"}
            onClick={() => setPane("inspector")}
          >
            Inspector
          </button>
        </div>
        {viewNotice && (
          <p className="view-notice" role="status">
            {viewNotice}
          </p>
        )}
        <div
          className="workspace-panels"
          data-pane={pane}
          ref={panels}
          style={splitStyle(split)}
        >
          <section
            className="code-panel"
            id="studio-code"
            aria-label="Código fuente"
          >
            <div className="panel-caption">
              <span>{doc.name}</span>
              <span>Ctrl / ⌘ + Enter</span>
            </div>
            <div className="studio-editor">
              <Suspense
                fallback={
                  <pre className="studio-pre fallback">{doc.source}</pre>
                }
              >
                <Editor
                  value={doc.source}
                  onChange={(source) => updateDocument({ source })}
                  onRun={run}
                  diagnostics={diagnostics}
                  focusRange={focusRange}
                  label="Código ETL del documento"
                />
              </Suspense>
            </div>
          </section>
          <PanelSplitter
            panels={panels}
            value={split}
            onCommit={commitSplit}
            controls="studio-code studio-inspector"
          />
          <section
            className="inspector-panel"
            id="studio-inspector"
            aria-label="Inspector de compilación"
          >
            <div className="studio-out-bar">
              <div className="studio-formats" aria-label="Vistas del estudio">
                {INSPECTORS.map(([f, label]) => (
                  <button
                    key={f}
                    aria-pressed={f === fmt}
                    onClick={() => selectInspector(f)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="studio-out"
              tabIndex={0}
              aria-label="Salida"
              data-origin={origin}
            >
              <div className="result-caption">
                <span className="origin-tag">
                  {origin}
                  {result ? ` · revisión ${result.revision}` : ""}
                </span>
              </div>
              {!current && result && (
                <p className="stale-note">
                  El documento o los pases cambiaron. Esta salida pertenece a la
                  revisión {result.revision}; compila para actualizarla. Python
                  no está disponible para descarga.
                </p>
              )}
              {result ? (
                <Suspense
                  fallback={<p className="empty-output">Cargando inspector…</p>}
                >
                  <Inspector
                    inspector={fmt}
                    analysis={analysis}
                    views={result.result.views}
                    current={current}
                    onSelect={selectSource}
                  />
                </Suspense>
              ) : (
                <p className="empty-output">
                  Pulsa Compilar para cargar Python y obtener las fases de este
                  documento.
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="diagnostic-panel" aria-label="Diagnósticos">
          <h2>Diagnósticos {current ? `(${diagnostics.length})` : ""}</h2>
          {diagnostics.length ? (
            <ul>
              {diagnostics.map((d, i) => (
                <li key={i}>
                  <button
                    className="diagnostic-link"
                    onClick={() => showDiagnostic(d)}
                  >
                    <strong>{d.code}</strong>
                    <span>{d.message}</span>
                    <span className="diagnostic-location">
                      {d.span.line}:{d.span.column} · {d.phase}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {!current
                ? "Compila esta revisión para localizar sus errores."
                : result?.result.ok
                  ? "Sin errores en las fases solicitadas. Los datasets se validan al ejecutar fuera del navegador."
                  : "Consulta la salida de la fase y el estado del compilador."}
            </p>
          )}
          {diagnostics.some((d) => d.code === "E_NULL_COMPARISON") && (
            <p>
              <a href="/docs/null-contratos">
                Cómo corregir comparaciones con NULL
              </a>
            </p>
          )}
        </section>
        <Suspense fallback={<p>Cargando resultados…</p>}>
          <ExecutionPanel
            doc={doc}
            analysis={analysis}
            current={current}
            reveal={reveal}
          />
        </Suspense>
        <div className="workspace-runtime">
          <p
            className="studio-status"
            data-status={runtime.status}
            role="status"
          >
            {runtime.status === "idle"
              ? runtime.detail ||
                "Python se descarga al compilar por primera vez."
              : runtime.detail}
            {runtime.status === "ready"
              ? " · compila tras una pausa al editar"
              : ""}
          </p>
          {runtime.status !== "idle" && (
            <button className="tool-button" onClick={restartCompiler}>
              Reiniciar compilador
            </button>
          )}
        </div>
      </div>
      {(message || error) && (
        <p className="workspace-message" role="status">
          {error || message}
        </p>
      )}
      <details className="drafts">
        <summary>Borradores anteriores ({workspace.drafts.length}/8)</summary>
        <p>
          Al abrir una copia o importar, el documento anterior se conserva aquí.
          Hasta 128 KiB por documento y 512 KiB en total; si falla el guardado,
          descarga tu trabajo antes de salir.
        </p>
        {workspace.drafts.length ? (
          <ul>
            {workspace.drafts.map((draft) => (
              <li key={draft.id}>
                <span>
                  {draft.name} · revisión {draft.revision}
                </span>
                <button
                  className="tool-button"
                  onClick={() => {
                    openDocument(draft);
                    setMessage(
                      "Borrador recuperado. El documento anterior sigue disponible.",
                    );
                  }}
                >
                  Recuperar <span className="sr">{draft.name}</span>
                </button>
                <button
                  className="tool-button"
                  onClick={() => downloadText(draft.name, draft.source)}
                >
                  Descargar <span className="sr">{draft.name}</span>
                </button>
                <button
                  className="tool-button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Eliminar el borrador ${draft.name}? Descárgalo antes si quieres conservarlo.`,
                      )
                    )
                      removeDraft(draft.id);
                  }}
                >
                  Eliminar <span className="sr">{draft.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Todavía no hay documentos anteriores.</p>
        )}
      </details>
    </main>
  );
}
