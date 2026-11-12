import { useMemo } from "react";
import type { Artifact } from "../../compiler/types";
import { available, unavailable } from "./model";
import { parseTree } from "./tree";
import TreeGraph from "./TreeGraph";
import type { SourceProps } from "./SourceButton";
export default function ParseTreeInspector({
  artifact,
  ...source
}: SourceProps & { artifact?: Artifact<string> }) {
  const text = available(artifact);
  const data = useMemo(() => (text ? parseTree(text) : null), [text]);
  return (
    <div className="structured-inspector">
      <h2>Parse tree</h2>
      <p>
        Cómo la gramática reconoce tu programa. Cada conexión une una regla con
        sus partes; + abre una rama. El AST resume esta estructura en conceptos
        del lenguaje.
      </p>
      {data ? (
        <TreeGraph key={text} data={data} source={source} label="Parse tree" />
      ) : (
        <p>{unavailable(artifact)}</p>
      )}
      {text && (
        <details className="inspector-text">
          <summary>Árbol textual completo</summary>
          <pre>{text}</pre>
        </details>
      )}
    </div>
  );
}
