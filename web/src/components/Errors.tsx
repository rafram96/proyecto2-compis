import { useState } from "react";
import { programs } from "../data";
import { highlight } from "./highlight";

const bad = programs["pendientes.etl"];
const good = programs["pendientes_ok.etl"];
const [diag] = bad.default.check.analysis!.diagnostics;
const { line, column } = diag.span;
const badLine = bad.source.split("\n")[line - 1].trimStart();
const goodLine = good.source.split("\n")[line - 1].trimStart();
const okText = good.default.check.out.trim().replace(/^OK: [^:]+: /, "");
// Lo subrayado: desde la columna del diagnóstico hasta el fin de la comparación.
const lead = bad.source.split("\n")[line - 1].length - badLine.length;
const start = column - 1 - lead;
const end = badLine.indexOf(";", start);

function Line({ fixed }: { fixed: boolean }) {
  if (fixed) {
    return (
      <pre className="diag-src">
        <span className="gutter">{line}</span>
        {highlight(goodLine)}
      </pre>
    );
  }
  return (
    <pre className="diag-src">
      <span className="gutter">{line}</span>
      {highlight(badLine.slice(0, start))}
      <span className="squiggle">{highlight(badLine.slice(start, end))}</span>
      {highlight(badLine.slice(end))}
    </pre>
  );
}

function Row({ state, onFix, onUndo }: { state: "error" | "hover" | "ok"; onFix?(): void; onUndo?(): void }) {
  const ok = state === "ok";
  return (
    <div className={`diag ${state}`} data-ui>
      <div className="diag-head">
        <span className={`sev ${ok ? "good" : ""}`} aria-hidden="true" />
        <code>{ok ? "OK" : diag.code}</code>
        <span className="loc">{ok ? "pendientes.etl" : `pendientes.etl:${line}:${column}`}</span>
      </div>
      <p className="msg">{ok ? okText : diag.message}</p>
      <Line fixed={ok} />
      {state === "hover" && (
        <div className="diag-actions">
          <button type="button" className="ui-btn primary" onClick={onFix}>
            Cambiar a IS NULL
          </button>
          <span>o ábrelo en el estudio</span>
          <svg className="pointer" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3l13 8.2-5.6 1.2 3.4 6.4-2.6 1.4-3.4-6.4L5 18z" />
          </svg>
        </div>
      )}
      {ok && onUndo && (
        <div className="diag-actions">
          <button type="button" className="ui-btn" onClick={onUndo}>
            Volver al error
          </button>
        </div>
      )}
    </div>
  );
}

export function Errors() {
  const [fixed, setFixed] = useState(false);
  return (
    <section className="errors" id="errores" aria-labelledby="errores-t">
      <h2 id="errores-t" data-reveal>
        Errores que señalan la columna.
      </h2>
      <div className="states">
        <div className="state" data-reveal style={{ ["--d" as string]: 1 }}>
          <span className="state-word">Aparece</span>
          <Row state="error" />
        </div>
        <div className="state" data-reveal style={{ ["--d" as string]: 2 }}>
          <span className="state-word">{fixed ? "Lo corriges" : "Lo revisas"}</span>
          <div className="live" aria-live="polite">
            <Row state={fixed ? "ok" : "hover"} onFix={() => setFixed(true)} onUndo={() => setFixed(false)} />
          </div>
        </div>
        <div className="state" data-reveal style={{ ["--d" as string]: 3 }}>
          <span className="state-word">Resuelto</span>
          <Row state="ok" />
        </div>
      </div>
    </section>
  );
}
