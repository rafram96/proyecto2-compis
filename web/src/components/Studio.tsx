import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  compile,
  restartCompiler,
  SupersededError,
  useRuntime,
} from "../compiler/client";
import type { CompileResult, Format } from "../compiler/types";
import { programs } from "../data";
import { highlight } from "./highlight";
import { Output } from "./CompilerOutput";
import { createDocument } from "../workspace/model";
import { openDocument } from "../workspace/store";
import { navigate } from "../lib/router";

// CodeMirror llega en su propio paquete: la página no lo espera para pintarse.
const Editor = lazy(() => import("../editor/Editor"));

const EXAMPLES = ["ventas.etl", "credit_risk.etl", "pendientes.etl"] as const;
type Example = (typeof EXAMPLES)[number];

const FORMATS: [Format, string][] = [
  ["check", "Resultado"],
  ["tokens", "Tokens"],
  ["tree", "Árbol"],
  ["ast", "AST"],
  ["ir", "IR"],
  ["python", "Python"],
];

export function Studio() {
  const [name, setName] = useState<Example>("ventas.etl");
  const [sources, setSources] = useState(
    () =>
      Object.fromEntries(
        EXAMPLES.map((n) => [n, programs[n].source]),
      ) as Record<Example, string>,
  );
  const [fmt, setFmt] = useState<Format>("check");
  const [optimize, setOptimize] = useState(true);
  const [live, setLive] = useState<{
    key: string;
    result: CompileResult;
  } | null>(null);
  const cache = useRef(new Map<string, CompileResult>());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ticket = useRef(0);
  useEffect(
    () => () => {
      ticket.current++;
    },
    [],
  );
  const runtime = useRuntime();

  const source = sources[name];
  const pristine = source === programs[name].source;
  const key = `${name}\u0000${fmt}\u0000${optimize}\u0000${source}`;
  const pre = pristine
    ? (!optimize && programs[name].O0[fmt]) || programs[name].default[fmt]
    : null;
  const fresh =
    cache.current.get(key) ?? (live?.key === key ? live.result : null);
  const shown =
    fresh ??
    pre ??
    (live?.key.startsWith(`${name}\u0000${fmt}\u0000`) ? live.result : null);
  const origin = fresh ? "en vivo" : pre ? "precalculado" : "desactualizado";

  const diagnostics = useMemo(
    () => (shown && (fresh || pre) ? (shown.analysis?.diagnostics ?? []) : []),
    [shown, fresh, pre],
  );

  const latest = useRef({ key, source, name, fmt, optimize });
  latest.current = { key, source, name, fmt, optimize };

  const run = useCallback(async () => {
    const req = latest.current;
    const request = ++ticket.current;
    setBusy(true);
    try {
      const result = await compile({
        source: req.source,
        name: req.name,
        fmt: req.fmt,
        passes: req.optimize ? null : [],
      });
      if (request === ticket.current && req.key === latest.current.key) {
        // Caché acotada para volver a una fase ya compilada sin repetir trabajo.
        if (cache.current.size >= 24)
          cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(req.key, result);
        setLive({ key: req.key, result });
        setMessage("");
      }
    } catch (e) {
      if (
        request === ticket.current &&
        req.key === latest.current.key &&
        !(e instanceof SupersededError)
      )
        setMessage(String(e));
    } finally {
      if (request === ticket.current) setBusy(false);
    }
  }, []);

  // Con Python ya cargado, compila mientras escribes (con una pausa corta para no compilar cada tecla).
  useEffect(() => {
    if (runtime.status !== "ready" || fresh || busy) return;
    const t = window.setTimeout(run, 320);
    return () => window.clearTimeout(t);
  }, [key, runtime.status, fresh, busy, run]);

  const status =
    runtime.status === "idle"
      ? "Salida precalculada por el compilador. Al compilar, tu navegador descarga Python una sola vez."
      : runtime.status === "loading"
        ? runtime.detail
        : runtime.status === "ready"
          ? `${runtime.detail} · compila mientras escribes`
          : `Compilador detenido: ${runtime.detail}`;

  return (
    <section className="cta" id="estudio" aria-labelledby="cta-t">
      <div className="cta-copy" data-reveal>
        <h2 id="cta-t">Tu primer pipeline.</h2>
        <p>
          Edita el ejemplo y pulsa Compile. Corre el mismo etl_dsl de la
          terminal, dentro de tu navegador; tus datos no salen de tu equipo.
        </p>
      </div>

      <div
        className="studio"
        data-ui
        data-reveal
        style={{ ["--d" as string]: 1 }}
      >
        <div className="studio-bar" role="tablist" aria-label="Ejemplos">
          {EXAMPLES.map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={n === name}
              onClick={() => setName(n)}
            >
              {n}
              {sources[n] !== programs[n].source && (
                <span className="dirty" aria-label="modificado" />
              )}
            </button>
          ))}
          {!pristine && (
            <button
              className="reset"
              onClick={() =>
                setSources((s) => ({ ...s, [name]: programs[name].source }))
              }
            >
              Restaurar
            </button>
          )}
        </div>

        <div className="studio-editor">
          <Suspense
            fallback={
              <pre className="studio-pre fallback">{highlight(source)}</pre>
            }
          >
            <Editor
              value={source}
              onChange={(v) => setSources((s) => ({ ...s, [name]: v }))}
              onRun={run}
              diagnostics={diagnostics}
              label={`Editor de ${name}`}
            />
          </Suspense>
        </div>

        <div className="studio-out-bar">
          <div
            role="tablist"
            aria-label="Salida del compilador"
            className="studio-formats"
          >
            {FORMATS.map(([f, label]) => (
              <button
                key={f}
                role="tab"
                aria-selected={f === fmt}
                onClick={() => setFmt(f)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={optimize}
            className="mini-switch"
            onClick={() => setOptimize((o) => !o)}
          >
            <span aria-hidden="true" />
            Optimizar
          </button>
        </div>

        <div
          className="studio-out"
          tabIndex={0}
          aria-label="Salida"
          data-origin={origin}
        >
          <span className="origin-tag">{busy ? "compilando…" : origin}</span>
          {shown ? (
            <Output fmt={fmt} result={shown} />
          ) : (
            <pre className="studio-pre muted">
              Pulsa Compile para ver la salida de tu versión.
            </pre>
          )}
        </div>

        <div className="studio-foot">
          {runtime.status === "error" && (
            <button className="tool-button" onClick={restartCompiler}>
              Reiniciar compilador
            </button>
          )}
          <p
            className="studio-status"
            role="status"
            data-status={runtime.status}
          >
            {status}
          </p>
          <button
            className="btn"
            type="button"
            onClick={run}
            disabled={busy}
            aria-keyshortcuts="Control+Enter Meta+Enter"
          >
            {busy && runtime.status === "loading" ? "Cargando…" : "Compile"}
          </button>
        </div>
      </div>
      <div className="demo-open">
        <a
          className="btn"
          href="/studio"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            try {
              openDocument(createDocument(name, source, optimize ? null : []));
              navigate("/studio");
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : String(error),
              );
            }
          }}
        >
          Continuar en Studio
        </a>
        {message && <p role="status">{message}</p>}
      </div>
    </section>
  );
}
