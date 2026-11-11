/** Subconjunto de Markdown de nuestras fuentes: sin HTML crudo ni ejecución. */
export type Block =
  | { kind: "heading"; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language: string }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "table"; rows: string[][] };
export function markdown(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  const special = (line: string) => /^(## |```|\||[-*] |\d+\. )/.test(line);
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      const text = line.slice(3);
      const base = text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const count = ids.get(base) ?? 0;
      ids.set(base, count + 1);
      blocks.push({
        kind: "heading",
        text,
        id: count ? `${base}-${count + 1}` : base,
      });
      i++;
    } else if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const body = [];
      for (i++; i < lines.length && !lines[i].startsWith("```"); i++)
        body.push(lines[i]);
      blocks.push({ kind: "code", text: body.join("\n"), language });
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const row = lines[i++]
          .trim()
          .slice(1, -1)
          .split("|")
          .map((cell) => cell.trim());
        if (!row.every((cell) => /^:?-+:?$/.test(cell))) rows.push(row);
      }
      blocks.push({ kind: "table", rows });
    } else if (/^([-*] |\d+\. )/.test(line)) {
      const ordered = /^\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^([-*] |\d+\. )/.test(lines[i])) {
        let item = lines[i++].replace(/^([-*] |\d+\. )/, "");
        while (i < lines.length && lines[i].trim() && !special(lines[i]))
          item += " " + lines[i++].trim();
        items.push(item);
      }
      blocks.push({ kind: "list", items, ordered });
    } else {
      const body = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !special(lines[i]))
        body.push(lines[i++]);
      blocks.push({ kind: "paragraph", text: body.join(" ") });
    }
  }
  return blocks;
}
