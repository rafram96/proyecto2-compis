import { useMemo, useState } from "react";
import type { Artifact } from "../../compiler/types";
import type { SourceProps } from "./SourceButton";
import { SourceButton } from "./SourceButton";
import {
  available,
  label,
  pipelines,
  record,
  spanOf,
  title,
  unavailable,
} from "./model";
import TreeGraph from "./TreeGraph";
import { astTree } from "./tree";

function Branch({
  value,
  name,
  depth,
  source,
}: {
  value: unknown;
  name: string;
  depth: number;
  source: SourceProps;
}) {
  if (!record(value) && !Array.isArray(value))
    return (
      <li className="ast-property">
        <span>{name}</span> <code>{JSON.stringify(value)}</code>
      </li>
    );
  const entries = Object.entries(value).filter(
    ([k]) => k !== "span" && k !== "node",
  );
  const node = record(value) ? value : undefined;
  return (
    <li>
      <details open={depth < 3} className="ast-branch">
        <summary>
          {name}{" "}
          <strong>{node ? title(node) : `${entries.length} elementos`}</strong>
        </summary>
        {node && spanOf(node.span) && (
          <SourceButton {...source} span={spanOf(node.span)}>
            Seleccionar {title(node)}
          </SourceButton>
        )}
        <ul>
          {entries.map(([key, child]) => (
            <Branch
              key={key}
              value={child}
              name={Array.isArray(value) ? `${Number(key) + 1}` : key}
              depth={depth + 1}
              source={source}
            />
          ))}
        </ul>
      </details>
    </li>
  );
}
export default function AstInspector({
  artifact,
  text,
  ...source
}: SourceProps & { artifact?: Artifact; text: string }) {
  const data = available(artifact);
  const pipes = pipelines(data);
  const [selected, setSelected] = useState("");
  const name = pipes.some((p) => p.name === selected)
    ? selected
    : label(pipes[0]?.name);
  const pipeline = pipes.find((p) => p.name === name) ?? data;
  const graph = useMemo(() => astTree(pipeline), [pipeline]);
  return (
    <div className="structured-inspector">
      <h2>AST · estructura del programa</h2>
      <p>
        Explora las declaraciones y expresiones de cada pipeline. Hover o foco
        resalta su código; un clic selecciona el rango original. Usa + para
        abrir una rama.
      </p>
      {data ? (
        <>
          <label>
            Pipeline{" "}
            <select
              aria-label="Pipeline del AST"
              value={name}
              onChange={(event) => setSelected(event.target.value)}
            >
              {pipes.map((p) => (
                <option key={label(p.name)}>{label(p.name)}</option>
              ))}
            </select>
          </label>
          <TreeGraph key={name} data={graph} source={source} label="AST" />
          <details className="inspector-text ast-properties">
            <summary>Explorar propiedades del AST</summary>
            <ul className="ast-tree">
              <Branch value={data} name="AST" depth={0} source={source} />
            </ul>
          </details>
        </>
      ) : (
        <p>{unavailable(artifact)}</p>
      )}
      {text && (
        <details className="inspector-text">
          <summary>AST textual / JSON compacto</summary>
          <pre>{text}</pre>
        </details>
      )}
      {data !== undefined && (
        <details className="inspector-text">
          <summary>JSON completo con posiciones</summary>
          <pre>{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
