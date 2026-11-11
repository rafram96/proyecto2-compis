import { type Cell, REFERENCE, ms, ticks } from "./model";

const ROW = 46;
const LEFT = 128;
const RIGHT = 96;
const WIDTH = 720;

/**
 * Puntos individuales, IQR y mediana de las mismas filas de la tabla. Eje lineal desde 0 ms:
 * no se trunca para exagerar diferencias. La identidad está en el texto de cada fila, no en el color.
 */
export function DispersionChart({ rows, caption }: { rows: Cell[]; caption: string }) {
  const { top, values } = ticks(Math.max(...rows.map((r) => r.max)));
  const plot = WIDTH - LEFT - RIGHT;
  const x = (v: number) => LEFT + (v / top) * plot;
  const height = rows.length * ROW + 44;
  const reference = rows.find((r) => r.configuration === REFERENCE);
  return (
    <figure className="eval-chart">
      <p className="eval-scroll-hint">Desliza el gráfico horizontalmente para ver toda la escala.</p>
      <div className="eval-scroll" tabIndex={0} role="region" aria-label="Gráfico de dispersión, desplazable">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-label={`${caption}. ${rows
            .map((r) => `${r.configuration}: mediana ${ms(r.median)} ms, IQR ${ms(r.iqr)} ms`)
            .join("; ")}.`}
        >
          {values.map((v) => (
            <g key={v} className="eval-grid">
              <line x1={x(v)} x2={x(v)} y1={8} y2={rows.length * ROW + 8} />
              <text x={x(v)} y={rows.length * ROW + 28} textAnchor="middle">
                {v}
              </text>
            </g>
          ))}
          <text className="eval-axis-label" x={LEFT + plot} y={rows.length * ROW + 42} textAnchor="end">
            ms (eje lineal desde 0)
          </text>
          {reference && (
            <g className="eval-reference">
              <line x1={x(reference.median)} x2={x(reference.median)} y1={4} y2={rows.length * ROW + 10} />
            </g>
          )}
          {rows.map((row, i) => {
            const y = i * ROW + 8 + ROW / 2;
            return (
              <g key={row.configuration} className="eval-row" data-config={row.configuration}>
                <text x={LEFT - 12} y={y + 5} textAnchor="end" className="eval-row-label">
                  {row.configuration}
                </text>
                <rect
                  className="eval-iqr"
                  x={x(row.p25)}
                  y={y - 9}
                  width={Math.max(2, x(row.p75) - x(row.p25))}
                  height={18}
                  rx={3}
                >
                  <title>{`${row.configuration}: P25 ${ms(row.p25)} ms – P75 ${ms(row.p75)} ms`}</title>
                </rect>
                {row.samples.map((value, k) => (
                  <circle
                    key={k}
                    className="eval-sample"
                    cx={x(value)}
                    cy={y + ((k % 5) - 2) * 3}
                    r={3.5}
                  >
                    <title>{`${row.configuration}, repetición ${k + 1}: ${ms(value)} ms`}</title>
                  </circle>
                ))}
                <line className="eval-median" x1={x(row.median)} x2={x(row.median)} y1={y - 14} y2={y + 14}>
                  <title>{`${row.configuration}: mediana ${ms(row.median)} ms`}</title>
                </line>
                <text x={WIDTH - RIGHT + 12} y={y + 5} className="eval-row-value">
                  {ms(row.median)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>
        {caption}. Cada punto es una repetición; la caja va de P25 a P75 y la barra vertical marca la mediana
        (valor a la derecha, en ms). La línea discontinua es la mediana de O0 de esta misma celda. Los mismos
        valores están en la tabla anterior; pasa el cursor sobre un punto para ver su repetición.
      </figcaption>
    </figure>
  );
}
