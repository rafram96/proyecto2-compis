import { diffArrays } from "diff";
export type DiffCell = {
  text: string;
  number: number;
  change: "same" | "remove" | "add";
};
export type DiffRow = { before?: DiffCell; after?: DiffCell };
/** Mantiene alineados los cambios y no considera iguales líneas diferentes.
 * Acota Myers; el fallback conserva íntegros ambos textos como reemplazo. */
export function alignedDiff(
  before: string,
  after: string,
): { rows: DiffRow[]; removed: number; added: number; limited: boolean } {
  const a = before ? before.split("\n") : [],
    b = after ? after.split("\n") : [];
  const changes = diffArrays(a, b, { timeout: 35, maxEditLength: 1500 });
  const parts = changes ?? [
    { value: a, added: false, removed: true },
    { value: b, added: true, removed: false },
  ];
  const rows: DiffRow[] = [];
  let left = 0,
    right = 0,
    removed = 0,
    added = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.removed) {
      const next = parts[i + 1]?.added ? parts[++i] : undefined;
      for (
        let n = 0;
        n < Math.max(part.value.length, next?.value.length ?? 0);
        n++
      ) {
        const row: DiffRow = {};
        if (n < part.value.length) {
          row.before = {
            text: part.value[n],
            number: ++left,
            change: "remove",
          };
          removed++;
        }
        if (next && n < next.value.length) {
          row.after = { text: next.value[n], number: ++right, change: "add" };
          added++;
        }
        rows.push(row);
      }
    } else if (part.added) {
      for (const text of part.value) {
        rows.push({ after: { text, number: ++right, change: "add" } });
        added++;
      }
    } else
      for (const text of part.value)
        rows.push({
          before: { text, number: ++left, change: "same" },
          after: { text, number: ++right, change: "same" },
        });
  }
  return { rows, removed, added, limited: !changes };
}
