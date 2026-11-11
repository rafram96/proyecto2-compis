import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { restartCompiler } from "../compiler/client";
import { editorDiagnostics } from "../compiler/diagnostics";
import { examples } from "../content";
import { Output } from "../components/CompilerOutput";
import {
  createDocument,
  fileName,
  FORMATS,
  importText,
  MAX_SOURCE,
  pythonDownload,
} from "../workspace/model";
import {
  getWorkspace,
  openDocument,
  removeDraft,
  updateDocument,
  useWorkspace,
} from "../workspace/store";
import { downloadText } from "../workspace/files";
import { useCompilation } from "../workspace/useCompilation";
import type { Diagnostic } from "../compiler/types";
const Editor = lazy(() => import("../editor/Editor"));

export default function StudioPage() {
  const { workspace, notice, saved } = useWorkspace();
  const doc = workspace.active;
  const { result, current, runtime, busy, error, run } = useCompilation(doc);
  const [pane, setPane] = useState<"code" | "inspector">("code");
  const [message, setMessage] = useState("");
  const [focusRange, setFocusRange] = useState<{
    from: number;
    to: number;
    token: number;
  }>();
  const input = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = "Estudio · Cauce";
    heading.current?.focus({ preventScroll: true });
  }, []);
  const analysis = result?.result.analysis;
  const diagnostics = current ? (analysis?.diagnostics ?? []) : [];
  const python = pythonDownload(doc, result);
  const fmt = doc.inspector;
  const text = result?.result.views?.[fmt] ?? "";
  const artifact =
    fmt === "check"
      ? null
      : analysis?.artifacts[fmt === "ir" ? "ir_before" : fmt];
  const origin = result
    ? current
      ? "en vivo"
      : "desactualizado"
    : "sin compilar";
  function showDiagnostic(diagnostic: Diagnostic) {
    const [range] = editorDiagnostics(doc.source, [diagnostic]);
    if (!range) return;
    setPane("code");
    setFocusRange({ from: range.from, to: range.to, token: Date.now() });
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
          Compilación local · sin ejecución de datos
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
          <label>
            Pases
            <select
              aria-label="Pases de optimización"
              value={doc.passes === null ? "default" : "O0"}
              onChange={(e) =>
                updateDocument({
                  passes: e.target.value === "default" ? null : [],
                })
              }
            >
              <option value="default">Predeterminados</option>
              <option value="O0">Sin pases (O0)</option>
            </select>
          </label>
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
        <div className="workspace-panels" data-pane={pane}>
          <section className="code-panel" aria-label="Código fuente">
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
          <section
            className="inspector-panel"
            aria-label="Inspector de compilación"
          >
            <div className="studio-out-bar">
              <div className="studio-formats" aria-label="Fase del compilador">
                {FORMATS.map(([f, label]) => (
                  <button
                    key={f}
                    aria-pressed={f === fmt}
                    onClick={() => updateDocument({ inspector: f })}
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
              {text ? (
                <Output
                  fmt={fmt}
                  result={{ ok: true, out: text, err: "", analysis: null }}
                />
              ) : (
                <p className="empty-output">
                  {!result
                    ? "Pulsa Compilar para cargar Python y obtener las fases de este documento."
                    : artifact?.status === "blocked"
                      ? "Esta fase está bloqueada por un error. Los artefactos de fases anteriores siguen disponibles."
                      : artifact?.status === "not_requested"
                        ? "Este artefacto no se solicitó."
                        : result.result.err ||
                          "No hay salida disponible para esta fase."}
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
