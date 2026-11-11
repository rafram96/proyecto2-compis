import { useId, useMemo, useState } from "react";
import type { Artifact } from "../../compiler/types";
import { available, flowGraph, label, pipelines, unavailable } from "./model";
import { SourceButton, type SourceProps } from "./SourceButton";
export default function FlowInspector({
  artifact,
  ...source
}: SourceProps & { artifact?: Artifact }) {
  const ast = available(artifact);
  const pipes = pipelines(ast);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState("graph");
  const name = pipes.some((p) => p.name === selected)
    ? selected
    : label(pipes[0]?.name);
  const graph = useMemo(() => flowGraph(ast, name), [ast, name]);
  const arrow = useId().replace(/:/g, "");
  if (!ast)
    return (
      <div className="structured-inspector">
        <h2>FLOW original</h2>
        <p>{unavailable(artifact)}</p>
      </div>
    );
  return (
    <div className="structured-inspector">
      <h2>FLOW original</h2>
      <p>
        Declaraciones y conexiones del AST, antes de optimizar. Vista de
        lectura.
      </p>
      <div className="inspector-controls">
        <label>
          Pipeline{" "}
          <select
            aria-label="Pipeline de FLOW"
            value={name}
            onChange={(e) => setSelected(e.target.value)}
          >
            {pipes.map((p) => (
              <option key={label(p.name)}>{label(p.name)}</option>
            ))}
          </select>
        </label>
        <button
          className="tool-button"
          aria-pressed={view === "graph"}
          onClick={() => setView("graph")}
        >
          Grafo
        </button>
        <button
          className="tool-button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          Lista accesible
        </button>
      </div>
      {graph.unresolved && (
        <p className="stale-note">
          Estructura sin resolver: se muestran las declaraciones originales.
          Consulta los diagnósticos; la disposición no certifica un DAG válido.
        </p>
      )}
      {view === "graph" ? (
        <div
          className="flow-scroll"
          tabIndex={0}
          aria-label="Grafo FLOW, desplazable"
        >
          <div
            className="flow-canvas"
            style={{ width: graph.width, height: graph.height }}
          >
            <svg width={graph.width} height={graph.height} aria-hidden="true">
              <defs>
                <marker
                  id={arrow}
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0 0L8 4L0 8Z" fill="currentColor" />
                </marker>
              </defs>
              {graph.edges.map((e, i) => {
                const a = graph.nodes.find((n) => n.name === e.from),
                  b = graph.nodes.find((n) => n.name === e.to);
                if (!a || !b) return null;
                const ax = a.x + 92,
                  ay = a.y + a.height,
                  bx = b.x + 92,
                  by = b.y;
                return (
                  <g key={i}>
                    <path
                      d={`M${ax} ${ay} C${ax} ${ay + 36},${bx} ${by - 36},${bx} ${by}`}
                      fill="none"
                      stroke="currentColor"
                      markerEnd={`url(#${arrow})`}
                    />
                    {(e.fromPort || e.toPort) && (
                      <text x={(ax + bx) / 2 + 8} y={(ay + by) / 2}>
                        {[e.fromPort, e.toPort].filter(Boolean).join(" → ")}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
            {graph.nodes.map((n, i) => (
              <div
                className="flow-node"
                data-kind={n.kind}
                key={`${n.name}-${i}`}
                style={{ left: n.x, top: n.y, width: 184, height: n.height }}
              >
                <span className="flow-kind">
                  {n.kind}
                  {n.detail ? ` · ${n.detail}` : ""}
                </span>
                <SourceButton {...source} span={n.span}>
                  {n.name}
                </SourceButton>
                {n.inputs.map((p) => (
                  <code key={`in-${p}`}>entrada .{p}</code>
                ))}
                {n.outputs.map((p) => (
                  <code key={`out-${p}`}>salida .{p}</code>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <ul className="flow-list">
          {graph.nodes.map((n, i) => (
            <li key={i}>
              <strong>
                {n.kind} · {n.name}
              </strong>{" "}
              {n.detail}
              <SourceButton {...source} span={n.span} />
              {(n.inputs.length > 0 || n.outputs.length > 0) && (
                <p>
                  Entradas: {n.inputs.join(", ") || "—"} · Salidas:{" "}
                  {n.outputs.join(", ") || "—"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3>Conexiones · {graph.edges.length}</h3>
      <p className="inspector-note">
        Cada enlace selecciona la sentencia FLOW completa que lo declara.
      </p>
      <ul className="flow-connections">
        {graph.edges.map((e, i) => (
          <li key={i}>
            <SourceButton {...source} span={e.span}>
              {e.label}
            </SourceButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
