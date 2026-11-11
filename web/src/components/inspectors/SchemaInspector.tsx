import { useState } from "react";
import type { Artifact, InferredSchemas } from "../../compiler/types";
import {
  available,
  label,
  objects,
  record,
  spanOf,
  unavailable,
} from "./model";
import { SourceButton, type SourceProps } from "./SourceButton";
export default function SchemaInspector({
  artifact,
  before,
  ...source
}: SourceProps & { artifact?: Artifact<InferredSchemas>; before: unknown }) {
  const data = available(artifact);
  const [selected, setSelected] = useState("");
  const pipes = Object.keys(data ?? {});
  const name = pipes.includes(selected) ? selected : pipes[0];
  const original = record(before)
    ? objects(before.pipelines).find((p) => p.name === name)
    : undefined;
  return (
    <div className="structured-inspector">
      <h2>Esquemas estáticos</h2>
      <p>
        Esquemas inferidos de la IR original. No son datos observados ni el
        esquema final de la IR optimizada. Un conocimiento parcial no certifica
        columnas desconocidas.
      </p>
      {!data ? (
        <p>{unavailable(artifact)}</p>
      ) : (
        <>
          <label>
            Pipeline{" "}
            <select
              aria-label="Pipeline de esquemas"
              value={name}
              onChange={(e) => setSelected(e.target.value)}
            >
              {pipes.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
          {Object.entries(data[name] ?? {}).map(([node, ports]) => (
            <section className="schema-node" key={node}>
              <h3>{node}</h3>
              <SourceButton
                {...source}
                span={spanOf(
                  objects(original?.nodes).find((n) => n.name === node)?.span,
                )}
              />
              {Object.entries(ports).map(([port, schema]) => (
                <div key={port}>
                  <h4>
                    Puerto {port || "ordinario"} · conocimiento{" "}
                    {schema.complete ? "completo" : "parcial"}
                  </h4>
                  <div className="inspector-table-scroll">
                    <table>
                      <caption>
                        Columnas inferidas · {node}
                        {port ? `.${port}` : ""}
                      </caption>
                      <thead>
                        <tr>
                          <th>Columna</th>
                          <th>Tipos posibles</th>
                          <th>NULL posible</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schema.columns.map((c, i) => (
                          <tr key={`${c.name}-${i}`}>
                            <td>
                              <code>{c.name}</code>
                            </td>
                            <td>
                              {c.types === null
                                ? "Desconocido"
                                : c.types.length
                                  ? c.types.join(" | ")
                                  : "Null (sin tipo no nulo)"}
                            </td>
                            <td>{c.nullable ? "Sí" : "No"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {schema.columns.length === 0 && (
                    <p>No hay columnas conocidas.</p>
                  )}
                  {schema.absent.length > 0 && (
                    <p>
                      Ausencia conocida: {schema.absent.map(label).join(", ")}
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
