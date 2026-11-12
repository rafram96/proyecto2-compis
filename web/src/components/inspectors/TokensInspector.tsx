import { useMemo, useState } from "react";
import type { AnalysisResult } from "../../compiler/types";
import { available, unavailable } from "./model";
import { SourceButton, type SourceProps } from "./SourceButton";
export default function TokensInspector({
  artifact,
  ...source
}: SourceProps & { artifact?: AnalysisResult["artifacts"]["tokens"] }) {
  const tokens = available(artifact);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const kinds = useMemo(
    () => [...new Set(tokens?.map((t) => t.kind) ?? [])].sort(),
    [tokens],
  );
  const filtered = useMemo(
    () =>
      (tokens ?? [])
        .map((t, index) => ({ ...t, index }))
        .filter(
          (t) =>
            (!kind || t.kind === kind) &&
            `${t.lexeme} ${t.kind}`
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        ),
    [tokens, query, kind],
  );
  const last = Math.max(0, Math.ceil(filtered.length / 80) - 1),
    currentPage = Math.min(page, last);
  const start = currentPage * 80;
  return (
    <div className="structured-inspector tokens-inspector">
      <h2>Tokens · piezas del lenguaje</h2>
      <p>
        El análisis léxico divide el programa en palabras clave, nombres,
        valores y símbolos. Pulsa una ubicación para encontrar la pieza exacta
        en tu código.
      </p>
      {!tokens ? (
        <p>{unavailable(artifact)}</p>
      ) : (
        <>
          <div className="inspector-controls token-filters">
            <label>
              Buscar token
              <input
                type="search"
                value={query}
                placeholder="Lexema o tipo…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Tipo
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">Todos los tipos</option>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <p role="status">
            {filtered.length} de {tokens.length} tokens
            {filtered.length
              ? ` · mostrando ${start + 1}–${Math.min(start + 80, filtered.length)}`
              : " · prueba otra búsqueda"}
          </p>
          <div
            className="inspector-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Tabla de tokens, desplazable"
          >
            <table className="tokens-table">
              <caption>
                Orden original del análisis · ubicaciones de esta revisión
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Lexema</th>
                  <th scope="col">Fuente</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(start, start + 80).map((t) => (
                  <tr
                    key={t.index}
                    onMouseEnter={() => {
                      if (source.current) source.onPreview?.(t.span);
                    }}
                    onMouseLeave={() => source.onPreview?.()}
                  >
                    <td>{t.index + 1}</td>
                    <td>
                      <code className="token-kind">{t.kind}</code>
                    </td>
                    <td>
                      <code>{t.lexeme}</code>
                    </td>
                    <td>
                      <SourceButton {...source} span={t.span}>
                        L{t.span.line}:{t.span.column}
                      </SourceButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {last > 0 && (
            <div className="inspector-controls" aria-label="Páginas de tokens">
              <button
                className="tool-button"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                Anterior
              </button>
              <span>
                Página {currentPage + 1} de {last + 1}
              </span>
              <button
                className="tool-button"
                disabled={currentPage >= last}
                onClick={() => setPage(currentPage + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
