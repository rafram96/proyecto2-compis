import type { ReactNode } from "react";
import { ATOMS, CLAUSES, CONNECTORS, DECLS, FUNCS, LOGIC, OPERATIONS, TYPES } from "../editor/words";

/**
 * Resaltador mínimo para fragmentos estáticos: el DSL, la IR impresa y el Python generado.
 * El editor de verdad (CodeMirror) usa src/editor/etl.ts con el mismo vocabulario.
 */
const KW = [...DECLS, ...CLAUSES, ...LOGIC, ...OPERATIONS.map(([o]) => o), ...TYPES, "pipeline", "def", "return", "import", "from", "if", "raise", "not", "and"];
const LIT = [...ATOMS, "True", "False", "None"];
const FN = [...CONNECTORS, ...FUNCS, "filter", "sort", "select", "group_by", "agg", "source", "step", "sink", "col", "lit", "is_not_null", "is_null", "require_columns", "alias", "len"];
const RE = new RegExp(
  `(//[^\\n]*|#[^\\n]*)|("[^"\\n]*"|'[^'\\n]*')|(%\\w+)|\\b(${KW.join("|")})\\b|\\b(${FN.join("|")})\\b|\\b(${LIT.join("|")})\\b|(\\b\\d+(?:\\.\\d+)?\\b)`,
  "g",
);
const CLS = ["c", "s", "f", "k", "f", "n", "n"];

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const group = m.slice(1).findIndex((g) => g !== undefined);
    out.push(
      <span key={i++} className={CLS[group]}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
