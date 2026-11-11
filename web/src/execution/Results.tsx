import { useEffect, useState } from "react";
import type { Preview, Run } from "./types";
import { artifactUrl, preview } from "./client";
import { cellText } from "./model";
import PreviewChart from "./PreviewChart";

export default function Results({ run }: { run: Run }) {
  const [now, setNow] = useState(Date.now);
  const expired = run.expired || (run.expires_at != null && now >= run.expires_at * 1000);
  const [selected, setSelected] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ key: string; data: Preview } | null>(null);
  const [error, setError] = useState("");
  const outputs = run.outputs ?? [];
  const output = outputs.find((o) => o.id === selected) ?? outputs[0];
  const key = `${run.id}/${output?.id}/${offset}`;
  useEffect(() => {
    if (run.expires_at == null || run.expired) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, run.expires_at * 1000 - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [run.expires_at, run.expired]);
  useEffect(() => {
    const controller = new AbortController();
    if (output && !expired) {
      setError("");
      void preview(run.id, output.id, offset, controller.signal).then((data) => {
        if (!controller.signal.aborted) setPage({ key, data });
      }).catch((e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    }
    return () => controller.abort();
  }, [run.id, expired, output?.id, offset, key]);
  const data = page?.key === key ? page.data : null;
  if (expired) return <p role="status">Los resultados caducaron. Ejecuta de nuevo para obtener archivos.</p>;
  if (!output) return null;
  const artifact = run.artifacts?.find((a) => a.id === output.artifact_id);
  return <div className="execution-results">
    <div className="execution-toolbar">
      <label>Salida materializada
        <select aria-label="Salida materializada" value={output.id} onChange={(e) => { setSelected(e.target.value); setOffset(0); }}>
          {outputs.map((o) => <option key={o.id} value={o.id}>{o.pipeline}.{o.declaration} · {o.kind} · {o.rows} filas</option>)}
        </select>
      </label>
      {artifact && <a className="tool-button" href={artifactUrl(run.id, artifact.id)} download={artifact.name}>Descargar {artifact.name} ({artifact.bytes} B)</a>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Cargando vista previa…</p>}
    {data && <>
      {data.total_rows === 0 && <p className="empty-output">Salida vacía válida · 0 filas. El archivo conserva el esquema.</p>}
      <div className="inspector-table-scroll" tabIndex={0} aria-label="Tabla de resultados">
        <table>
          <caption>{output.pipeline}.{output.declaration} · {data.total_rows} filas totales · vista previa de hasta 100 filas</caption>
          <thead><tr>{data.columns.map((c) => <th scope="col" key={c.name}>{c.name}</th>)}</tr></thead>
          <tbody>{data.rows.map((row, i) => <tr key={offset + i}>{row.map((cell, j) => <td key={j} data-null={cell === null || undefined}>{cellText(cell)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="execution-pagination" aria-label="Paginación de resultados">
        <button className="tool-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>Filas anteriores</button>
        <span>{data.total_rows ? `${offset + 1}–${Math.min(offset + data.rows.length, data.total_rows)} de ${data.total_rows}` : "0 de 0"}</span>
        <button className="tool-button" disabled={offset + data.rows.length >= data.total_rows} onClick={() => setOffset(offset + 100)}>Filas siguientes</button>
      </div>
      <PreviewChart data={data} />
      <details className="observed-schema"><summary>Esquema observado ({data.columns.length} columnas)</summary>
        <p>Orden y tipos físicos de la salida. «Contiene NULL» describe estos datos; el contrato declarado se muestra aparte.</p>
        <div className="inspector-table-scroll" tabIndex={0} aria-label="Esquema de resultados"><table>
          <thead><tr><th scope="col">Columna</th><th scope="col">Tipo físico</th><th scope="col">Contiene NULL</th><th scope="col">Contrato nullable</th></tr></thead>
          <tbody>{data.columns.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.dtype}</td><td>{c.nullable ? "Sí" : "No"}</td><td>{c.declared_nullable == null ? "Sin contrato" : c.declared_nullable ? "Sí" : "No"}</td></tr>)}</tbody>
        </table></div>
        <p>NULL es nulo; decimales y enteros fuera del rango seguro llegan como texto exacto, fechas en ISO y valores no finitos etiquetados. Descarga Parquet para conservar tipos físicos.</p>
      </details>
    </>}
  </div>;
}
