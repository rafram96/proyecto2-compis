import { useState } from "react";
import type { Preview } from "./types";
import { cellText } from "./model";

/** Gráfico de la página recibida; nunca infiere totales ni convierte textos exactos a Number. */
export default function PreviewChart({ data }: { data: Preview }) {
  const [column, setColumn] = useState("");
  const candidates = data.columns.filter((_, i) => data.rows.some((r) => typeof r[i] === "number") && data.rows.every((r) => r[i] === null || typeof r[i] === "number" && Number.isFinite(r[i])));
  const selected = candidates.find((c) => c.name === column) ?? candidates.find((c) => !/(^id$|_id$)/i.test(c.name)) ?? candidates[0];
  if (!selected || !data.rows.length) return null;
  const index = data.columns.findIndex((c) => c.name === selected.name);
  const rows = data.rows.slice(0, 20);
  const values = rows.map((r) => typeof r[index] === "number" ? r[index] as number : 0);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const scale = (value: number) => 180 + (value - min) / (max - min || 1) * 290;
  return <details className="preview-chart"><summary>Gráfico de esta página</summary>
    <label>Columna numérica del gráfico<select aria-label="Columna numérica del gráfico" value={selected.name} onChange={(e) => setColumn(e.target.value)}>{candidates.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
    <p>Primeras {rows.length} filas de la página actual. Valores exactos en la tabla; NULL no dibuja barra. Las columnas serializadas como texto conservan su precisión y se consultan en la tabla.</p>
    <div className="inspector-table-scroll" tabIndex={0} aria-label="Gráfico de resultados"><svg viewBox={`0 0 600 ${rows.length * 32 + 16}`} role="img" aria-label={`${selected.name} por fila de la página actual`}>
      <line x1={scale(0)} x2={scale(0)} y1={0} y2={rows.length * 32} stroke="currentColor" opacity=".4" />
      {rows.map((row, i) => <g key={i}>
        <text x={0} y={i * 32 + 20}>{`Fila ${data.offset + i + 1}`}</text>
        {row[index] !== null && <rect x={Math.min(scale(0), scale(values[i]))} y={i * 32 + 4} width={Math.abs(scale(values[i]) - scale(0))} height={22} fill="var(--primary)" />}
        <text x={490} y={i * 32 + 20}>{cellText(row[index])}</text>
      </g>)}
    </svg></div>
  </details>;
}
