import type { Artifact } from "../../compiler/types";
import type { SourceProps } from "./SourceButton";
import { SourceButton } from "./SourceButton";
import { available, record, spanOf, title, unavailable } from "./model";

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
  return (
    <div className="structured-inspector">
      <h2>Árbol de sintaxis abstracta</h2>
      <p>
        Expande propiedades y selecciona una ubicación del programa original.
      </p>
      {data ? (
        <ul className="ast-tree">
          <Branch value={data} name="AST" depth={0} source={source} />
        </ul>
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
