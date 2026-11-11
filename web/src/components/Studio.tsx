import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile, parseDiagnostics, useRuntime } from "../compiler/client";
import type { CompileResult, Format } from "../compiler/types";
import { programs } from "../data";
import { highlight } from "./highlight";

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

function Output({ fmt, result }: { fmt: Format; result: CompileResult }) {
  if (!result.ok) {
    return (
      <pre className="studio-pre">
        {result.err.split("\n").map((line, i) => {
          const m = /^([^:\n]+:\d+:\d+): ([A-Z_]+): (.*)$/.exec(line);
          return (
            <span key={i}>
              {m ? (
                <>
                  <span className="loc">{m[1]}</span> <b className="err">{m[2]}</b> {m[3]}
                </>
              ) : (
                line
              )}
              {"\n"}
            </span>
          );
        })}
      </pre>
    );
  }
  if (fmt === "check") return <pre className="studio-pre ok">{result.out}</pre>;
  if (fmt === "tokens" || fmt === "tree") return <pre className="studio-pre">{result.out}</pre>;
  return <pre className="studio-pre">{highlight(result.out)}</pre>;
}

export function Studio() {
  const [name, setName] = useState<Example>("ventas.etl");
  const [sources, setSources] = useState(() => Object.fromEntries(EXAMPLES.map((n) => [n, programs[n].source])) as Record<Example, string>);
  const [fmt, setFmt] = useState<Format>("check");
  const [optimize, setOptimize] = useState(true);
  const [live, setLive] = useState<{ key: string; result: CompileResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const runtime = useRuntime();

  const source = sources[name];
  const pristine = source === programs[name].source;
  const key = `${name}\u0000${fmt}\u0000${optimize}\u0000${source}`;
  const pre = pristine ? ((!optimize && programs[name].O0[fmt]) || programs[name].default[fmt]) : null;
  const fresh = live?.key === key ? live.result : null;
  const shown = fresh ?? pre ?? live?.result ?? null;
  const origin = fresh ? "en vivo" : pre ? "precalculado" : "desactualizado";

  const diagnostics = useMemo(() => (shown && (fresh || pre) ? parseDiagnostics(shown.err) : []), [shown, fresh, pre]);

  const latest = useRef({ key, source, name, fmt, optimize });
  latest.current = { key, source, name, fmt, optimize };

  const run = useCallback(async () => {
    const req = latest.current;
    setBusy(true);
    try {
      const result = await compile({ source: req.source, name: req.name, fmt: req.fmt, passes: req.optimize ? null : [] });
      setLive({ key: req.key, result });
    } catch (e) {
      setLive({ key: req.key, result: { ok: false, out: "", err: String(e) } });
    } finally {
      setBusy(false);
    }
  }, []);

  // Con Python ya cargado, compila mientras escribes (con una pausa corta para no compilar cada tecla).
  useEffect(() => {
    if (runtime.status !== "ready" || live?.key === key) return;
    const t = window.setTimeout(run, 320);
    return () => window.clearTimeout(t);
  }, [key, runtime.status, live?.key, run]);

  const status =
    runtime.status === "idle"
      ? "Salida precalculada por el compilador. Al compilar, tu navegador descarga Python una sola vez."
      : runtime.status === "loading"
        ? runtime.detail
        : runtime.status === "ready"
          ? `${runtime.detail} · compila mientras escribes`
          : `No se pudo cargar Python: ${runtime.detail}`;

  return (
    <section className="cta" id="estudio" aria-labelledby="cta-t">
      <div className="cta-copy" data-reveal>
        <h2 id="cta-t">Tu primer cauce.</h2>
        <p>Edita el ejemplo y pulsa Compilar. Corre el mismo etl_dsl de la terminal, dentro de tu navegador; tus datos no salen de tu equipo.</p>
      </div>

      <div className="studio" data-ui data-reveal style={{ ["--d" as string]: 1 }}>
        <div className="studio-bar" role="tablist" aria-label="Ejemplos">
          {EXAMPLES.map((n) => (
            <button key={n} role="tab" aria-selected={n === name} onClick={() => setName(n)}>
              {n}
              {sources[n] !== programs[n].source && <span className="dirty" aria-label="modificado" />}
            </button>
          ))}
          {!pristine && (
            <button className="reset" onClick={() => setSources((s) => ({ ...s, [name]: programs[name].source }))}>
              Restaurar
            </button>
          )}
        </div>

        <div className="studio-editor">
          <Suspense fallback={<pre className="studio-pre fallback">{highlight(source)}</pre>}>
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
          <div role="tablist" aria-label="Salida del compilador" className="studio-formats">
            {FORMATS.map(([f, label]) => (
              <button key={f} role="tab" aria-selected={f === fmt} onClick={() => setFmt(f)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" role="switch" aria-checked={optimize} className="mini-switch" onClick={() => setOptimize((o) => !o)}>
            <span aria-hidden="true" />
            Optimizar
          </button>
        </div>

        <div className="studio-out" tabIndex={0} aria-label="Salida" data-origin={origin}>
          <span className="origin-tag">{busy ? "compilando…" : origin}</span>
          {shown ? <Output fmt={fmt} result={shown} /> : <pre className="studio-pre muted">Pulsa Compilar para ver la salida de tu versión.</pre>}
        </div>

        <div className="studio-foot">
          <p className="studio-status" role="status" data-status={runtime.status}>
            {status}
          </p>
          <button className="btn" type="button" onClick={run} disabled={busy} aria-keyshortcuts="Control+Enter Meta+Enter">
            {busy && runtime.status === "loading" ? "Cargando…" : "Compilar"}
          </button>
        </div>
      </div>
    </section>
  );
}
