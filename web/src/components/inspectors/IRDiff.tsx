import { useMemo } from "react";
import { alignedDiff, type DiffCell } from "./diff";
import { clean, hasUnsafeInteger, type RecordValue } from "./model";
function text(node?: RecordValue) {
  return node
    ? JSON.stringify(
        clean({
          name: node.name,
          kind: node.kind,
          inputs: node.inputs,
          payload: node.payload,
        }),
        null,
        2,
      )
    : "";
}
function Cell({ cell }: { cell?: DiffCell }) {
  return (
    <td className="diff-cell" data-change={cell?.change ?? "empty"}>
      {cell && (
        <>
          <span className="diff-line-number"><span className="sr">Línea </span>{cell.number}</span>
          <span
            className="diff-sign"
            aria-hidden="true"
          >
            {cell.change === "remove" ? "−" : cell.change === "add" ? "+" : " "}
          </span>
          {cell.change !== "same" && <span className="sr">{cell.change === "remove" ? "Retirada: " : "Añadida: "}</span>}
          <code>{cell.text || " "}</code>
        </>
      )}
    </td>
  );
}
export default function IRDiff({
  before,
  after,
  comparable,
}: {
  before?: RecordValue;
  after?: RecordValue;
  comparable: boolean;
}) {
  const diff = useMemo(
    () => alignedDiff(text(before), text(after)),
    [before, after],
  );
  if (hasUnsafeInteger(before) || hasUnsafeInteger(after))
    return (
      <p>
        Este nodo contiene enteros fuera del rango seguro del navegador.
        Consulta la IR textual completa para comparar sus valores exactos.
      </p>
    );
  return (
    <>
      {comparable && (
        <p className="diff-summary">
          <span data-change="remove">− {diff.removed} líneas retiradas</span>
          <span data-change="add">+ {diff.added} líneas añadidas</span>
        </p>
      )}
      {diff.limited && (
        <p>
          Comparación extensa: se muestran ambos bloques como reemplazo
          completo.
        </p>
      )}
      <div
        className="ir-diff-scroll"
        tabIndex={0}
        role="region"
        aria-label="Diff IR, desplazable"
      >
        <table className="ir-diff">
          <caption className="sr">
            Comparación de propiedades de la misma compilación
          </caption>
          <thead>
            <tr>
              <th scope="col">Original</th>
              <th scope="col">
                Optimizada{!comparable ? " · no disponible" : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {diff.rows.map((row, i) => (
              <tr key={i}>
                <Cell
                  cell={
                    row.before && !comparable
                      ? { ...row.before, change: "same" }
                      : row.before
                  }
                />
                <Cell cell={row.after} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
