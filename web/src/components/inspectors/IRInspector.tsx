import { useState } from "react";
import type { AnalysisResult } from "../../compiler/types";
import {
  available,
  clean,
  compareIR,
  label,
  modulePipelines,
  objects,
  record,
  spanOf,
  strings,
  unavailable,
  type RecordValue,
} from "./model";
import { SourceButton, type SourceProps } from "./SourceButton";
import Evidence from "./Evidence";
function IRNode({
  node,
  original,
  source,
}: {
  node?: RecordValue;
  original: RecordValue[];
  source: SourceProps;
}) {
  if (!node)
    return <p className="ir-missing">Sin nodo correspondiente en esta IR.</p>;
  return (
    <div className="ir-node">
      <strong>
        {label(node.name)} · {label(node.kind)}
      </strong>
      <pre>
        {JSON.stringify(
          clean({ inputs: node.inputs, payload: node.payload }),
          null,
          2,
        )}
      </pre>
      <p>Origen: {strings(node.origin).join(" + ") || "sin procedencia"}</p>
      <SourceButton {...source} span={spanOf(node.span)} />
      {strings(node.origin).length > 1 && (
        <div className="origin-sources">
          {strings(node.origin).map((origin) => (
            <SourceButton
              key={origin}
              {...source}
              span={spanOf(
                original.find((n) => strings(n.origin).includes(origin))?.span,
              )}
            >
              Origen {origin}
            </SourceButton>
          ))}
        </div>
      )}
    </div>
  );
}
export default function IRInspector({
  analysis,
  text,
  ...source
}: SourceProps & { analysis?: AnalysisResult | null; text: string }) {
  const before = available(analysis?.artifacts.ir_before),
    after = available(analysis?.artifacts.ir_after);
  const beforePipes = modulePipelines(before?.module),
    afterPipes = modulePipelines(after?.module);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("comparison");
  const name = beforePipes.some((p) => p.name === selected)
    ? selected
    : label(beforePipes[0]?.name);
  const original = objects(beforePipes.find((p) => p.name === name)?.nodes),
    optimized = objects(afterPipes.find((p) => p.name === name)?.nodes);
  const rows = after
    ? compareIR(original, optimized)
    : original.map((n) => ({
        before: n,
        after: undefined,
        status: "sin correspondencia" as const,
      }));
  const module = record(after?.module) ? after.module : undefined;
  return (
    <div className="structured-inspector">
      <h2>Comparar IR</h2>
      <p>
        Dos IR de la misma compilación, relacionadas por su procedencia. Los
        nombres no establecen identidad entre revisiones.
      </p>
      <p>
        Orden solicitado: {analysis?.passes.join(" → ") || "ninguno"}. Pases
        aplicados: {analysis?.applied_passes.join(" → ") || "ninguno"}.
      </p>
      {analysis?.passes.length === 0 && (
        <p className="o0-note">
          O0: no se aplica ningún pase. La IR original se conserva; las
          obligaciones de ejecución siguen vigentes.
        </p>
      )}
      {!before ? (
        <p>{unavailable(analysis?.artifacts.ir_before)}</p>
      ) : (
        <>
          <label>
            Pipeline{" "}
            <select
              aria-label="Pipeline de IR"
              value={name}
              onChange={(e) => setSelected(e.target.value)}
            >
              {beforePipes.map((p) => (
                <option key={label(p.name)}>{label(p.name)}</option>
              ))}
            </select>
          </label>
          {!after && (
            <p>IR optimizada: {unavailable(analysis?.artifacts.ir_after)}</p>
          )}
          <div className="inspector-controls">
            <button
              className="tool-button"
              aria-pressed={view === "comparison"}
              onClick={() => setView("comparison")}
            >
              Comparación
            </button>
            <button
              className="tool-button"
              aria-pressed={view === "evidence" && !!after}
              disabled={!after}
              title={
                !after
                  ? "La IR optimizada no está disponible en este análisis"
                  : undefined
              }
              onClick={() => setView("evidence")}
            >
              Evidencia O1/O3
            </button>
          </div>
          {view === "comparison" || !after ? (
            <>
              <details>
                <summary>Cómo leer la comparación</summary>
                <p className="inspector-note">
                  Conservado: misma estructura. Cambiado: diferencia observada.
                  Eliminado: sin representación final por origen. Una fusión
                  conserva sus orígenes. Estas marcas no atribuyen cambios a
                  pases sin traza.
                </p>
              </details>
              <div className="ir-comparison">
                {rows.map((row, i) => (
                  <section
                    className="ir-row"
                    data-change={after ? row.status : "no disponible"}
                    key={i}
                  >
                    <h3>
                      {label(row.before?.name ?? row.after?.name)} ·{" "}
                      {after ? row.status : "comparación no disponible"}
                    </h3>
                    <div className="ir-pair">
                      <section aria-label="IR original">
                        <h4>Original</h4>
                        <IRNode
                          node={row.before}
                          original={original}
                          source={source}
                        />
                      </section>
                      <section aria-label="IR optimizada">
                        <h4>Optimizada</h4>
                        <IRNode
                          node={row.after}
                          original={original}
                          source={source}
                        />
                      </section>
                    </div>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <Evidence
              module={module}
              original={original}
              pipeline={name}
              {...source}
            />
          )}
        </>
      )}
      {text && (
        <details className="inspector-text">
          <summary>IR textual completa</summary>
          <pre>{text}</pre>
        </details>
      )}
      {before && (
        <details className="inspector-text">
          <summary>IR original textual</summary>
          <pre>{before.text}</pre>
        </details>
      )}
      {after && (
        <details className="inspector-text">
          <summary>IR optimizada textual</summary>
          <pre>{after.text}</pre>
        </details>
      )}
    </div>
  );
}
