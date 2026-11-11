import type { ReactNode } from "react";

const KW =
  "PIPELINE|STEP|FLOW|SOURCE|SINK|USE|INPUT|OUTPUT|FILTER|SORT|SELECT|DERIVE|AGGREGATE|FILL_NULL|DROP_NULLS|WHERE|BY|COLUMNS|DESC|ASC|AND|OR|NOT|IS|NULL|TRUE|FALSE|AS|TABLE|pipeline|def|return|import|from|None";
const FN = "CSV|PARQUET|SQLITE|DUCKDB|COUNT|AVG|COALESCE|SAFE_DIVIDE|filter|sort|select|source|step|sink|col|lit|is_not_null";
const RE = new RegExp(
  `(//[^\\n]*|#[^\\n]*)|("[^"\\n]*"|'[^'\\n]*')|\\b(${KW})\\b|\\b(${FN})\\b|(\\b\\d+(?:\\.\\d+)?\\b)`,
  "g",
);

/** Resaltador mínimo del DSL, la IR y el Python generado. */
export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "k" : m[4] ? "f" : "n";
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
