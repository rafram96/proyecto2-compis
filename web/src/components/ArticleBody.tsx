import type { ReactNode } from "react";
import type { Block } from "../content/markdown";
import { Code } from "./Code";
/**
 * Enlaces que el lector convierte en navegación interna. `/studio?vista=…` solo admite vistas
 * publicadas; gen_content.py rechaza cualquier otra antes del build.
 */
const INTERNAL =
  /^(https:\/\/|\/docs\/|\/ejemplos\/|\/(?:studio|estudio)(\?vista=(resultado|tokens|arbol|ast|flow|ir|esquemas|python|ejecucion))?$)/;
/** El lenguaje del bloque dice qué es: solo los fragmentos del DSL llevan resaltado. */
const CAPTIONS: Record<string, string> = {
  sh: "Comando de terminal",
  output: "Salida obtenida al ejecutarlo",
  csv: "Contenido del archivo CSV",
};
function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g)
    .map((part, i) => {
      if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
      if (part.startsWith("**"))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link)
        return INTERNAL.test(link[2]) ? (
          <a key={i} href={link[2]}>
            {link[1]}
          </a>
        ) : (
          link[1]
        );
      return part;
    });
}
export function ArticleBody({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, i) => {
    switch (block.kind) {
      case "heading":
        return (
          <h2 key={i} id={block.id} tabIndex={-1}>
            <a href={`#${block.id}`}>{block.text}</a>
          </h2>
        );
      case "paragraph":
        return <p key={i}>{inline(block.text)}</p>;
      case "code":
        return (
          <figure key={i}>
            <figcaption>
              {CAPTIONS[block.language] ?? "Fragmento de referencia · incompleto"}
            </figcaption>
            {block.language in CAPTIONS ? (
              // Literal y sin cortar líneas: un comando partido se copiaría mal.
              <Code
                code={block.text}
                verbatim
                plain
                label={`${CAPTIONS[block.language]}, desplazable`}
              />
            ) : (
              <Code code={block.text} />
            )}
          </figure>
        );
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={i}>
            {block.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </Tag>
        );
      }
      case "table":
        return (
          <div
            className="reference-table"
            key={i}
            tabIndex={0}
            role="region"
            aria-label="Tabla de referencia, desplazable"
          >
            <table>
              <thead>
                <tr>
                  {block.rows[0].map((cell, j) => (
                    <th key={j} scope="col">
                      {inline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.slice(1).map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      <td key={k}>{inline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}
