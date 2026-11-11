import type { Span } from "../../compiler/types";
import type { ReactNode } from "react";
export type SourceProps = { current: boolean; onSelect(span: Span): void };
export function SourceButton({
  span,
  current,
  onSelect,
  children,
}: SourceProps & { span?: Span; children?: ReactNode }) {
  return (
    <button
      className="source-button"
      disabled={!current || !span}
      onClick={() => {
        if (current && span) onSelect(span);
      }}
      title={
        !current
          ? "Compila esta revisión para seleccionar su fuente"
          : span
            ? `Seleccionar fuente · ${span.line}:${span.column}–${span.end_line}:${span.end_column}`
            : "Sin ubicación en el fuente"
      }
    >
      {children ?? "Ver fuente"}
    </button>
  );
}
