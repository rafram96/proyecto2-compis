import type { CompileResult, Format } from "../compiler/types.ts";

export const FORMATS: [Format, string][] = [
  ["check", "Resultado"],
  ["tokens", "Tokens"],
  ["tree", "Árbol"],
  ["ast", "AST"],
  ["ir", "IR"],
  ["python", "Python"],
];
export const PASSES = ["constantes", "rangos", "filtros", "joins", "muertos"];
export const MAX_SOURCE = 128 * 1024;
export const MAX_DRAFTS = 8;
export type Document = {
  id: string;
  name: string;
  source: string;
  revision: number;
  passes: string[] | null;
  inspector: Format;
};
export type Workspace = { version: 1; active: Document; drafts: Document[] };
export type DocumentResult = {
  documentId: string;
  revision: number;
  passes: string[] | null;
  result: CompileResult;
};
export const byteLength = (text: string) =>
  new TextEncoder().encode(text).length;
export function fileName(name: string) {
  const base =
    name
      .split(/[\\/]/)
      .pop()!
      .replace(/[\u0000-\u001f<>:"|?*]/g, "_")
      .trim()
      .slice(0, 100) || "programa.etl";
  return /\.etl$/i.test(base) ? base : `${base}.etl`;
}
export function createDocument(
  name: string,
  source: string,
  passes: string[] | null = null,
): Document {
  return {
    id: crypto.randomUUID(),
    name: fileName(name),
    source,
    revision: 1,
    passes,
    inspector: "check",
  };
}
export function revise(
  doc: Document,
  change: Partial<Pick<Document, "source" | "name" | "passes" | "inspector">>,
): Document {
  const next = { ...doc, ...change };
  const changed =
    next.source !== doc.source ||
    next.name !== doc.name ||
    JSON.stringify(next.passes) !== JSON.stringify(doc.passes);
  return { ...next, revision: doc.revision + (changed ? 1 : 0) };
}
export function replaceDocument(
  workspace: Workspace,
  next: Document,
): Workspace {
  const drafts = workspace.drafts.filter((d) => d.id !== next.id);
  if (drafts.length >= MAX_DRAFTS)
    throw new Error(
      "Hay 8 borradores anteriores. Descarga y elimina uno antes de abrir otro documento.",
    );
  return { version: 1, active: next, drafts: [workspace.active, ...drafts] };
}
export function isCurrent(doc: Document, result: DocumentResult | null) {
  return (
    !!result &&
    result.documentId === doc.id &&
    result.revision === doc.revision &&
    JSON.stringify(result.passes) === JSON.stringify(doc.passes)
  );
}
/** Nunca sustituye un resultado posterior ni deja que un documento distinto invada la vista. */
export function acceptResult(
  doc: Document,
  previous: DocumentResult | null,
  incoming: DocumentResult,
) {
  if (!isCurrent(doc, incoming)) return previous;
  if (
    previous?.documentId === incoming.documentId &&
    previous.revision > incoming.revision
  )
    return previous;
  return incoming;
}
export function importText(name: string, source: string) {
  if (!/\.etl$/i.test(name))
    throw new Error("Selecciona un archivo .etl de texto UTF-8.");
  if (byteLength(source) > MAX_SOURCE)
    throw new Error("El archivo supera el límite de 128 KiB.");
  return createDocument(name, source.replace(/^\uFEFF/, ""));
}
export function pythonDownload(doc: Document, result: DocumentResult | null) {
  if (!isCurrent(doc, result)) return null;
  const artifact = result!.result.analysis?.artifacts.python;
  return artifact?.status === "available"
    ? {
        name: fileName(doc.name).replace(/\.etl$/i, ".py"),
        text: artifact.data,
      }
    : null;
}
