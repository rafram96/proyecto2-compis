import type { Diagnostic } from "./types";

/** Convierte rangos Unicode de Python a offsets UTF-16, incluidos emoji y varias líneas. */
export function editorDiagnostics(source: string, diagnostics: readonly Diagnostic[]) {
  const lines = source.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  function position(line: number, column: number) {
    const index = Math.max(0, Math.min(line - 1, lines.length - 1));
    const prefix = Array.from(lines[index]).slice(0, Math.max(0, column - 1)).join("");
    return starts[index] + prefix.length;
  }

  return diagnostics
    .filter(({ span }) => span.line >= 1 && span.line <= lines.length)
    .map(({ span, severity, code, message }) => {
      const from = position(span.line, span.column);
      return { from, to: Math.max(from, position(span.end_line, span.end_column)), severity, message: `${code}: ${message}` };
    });
}
