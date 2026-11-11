import type { Document } from "../workspace/model.ts";
import type { Binding, Run, RunRequest } from "./types.ts";
import { label, objects, pipelines, record } from "../components/inspectors/model.ts";

export const activeRun = (run?: Run | null) => !!run && ["queued", "running"].includes(run.state);
export type Selection = { pipeline: string; datasets: Record<string, string> };
export type RequiredBinding = { pipeline: string; declaration: string; kind: string; driver: string; options: Record<string, unknown> };
/** Recorre referencias del AST para presentar declaraciones. El servidor valida el enlace real. */
export function bindingFields(ast: unknown, selected: string): RequiredBinding[] {
  const all = pipelines(ast), reached = new Set<string>();
  const visit = (name: string) => {
    if (reached.has(name)) return;
    reached.add(name);
    const pipe = all.find((p) => p.name === name);
    for (const d of objects(pipe?.declarations)) if (d.node === "Use") visit(label(d.pipeline));
  };
  visit(selected);
  return all.flatMap((p) => !reached.has(label(p.name)) ? [] : objects(p.declarations).flatMap((d) => {
    if (d.node !== "Source" && !(p.name === selected && d.node === "Input")) return [];
    const connector = record(d.connector) ? d.connector : {};
    return [{ pipeline: label(p.name), declaration: label(d.name), kind: label(d.node), driver: label(connector.name),
      options: Object.fromEntries(objects(connector.arguments).map((a) => [label(a.name), record(a.value) ? a.value.value : null])) }];
  }));
}
export const fieldKey = (field: Pick<Binding, "pipeline" | "declaration">) => `${field.pipeline}.${field.declaration}`;
export function runRequest(doc: Document, pipeline: string, bindings: Binding[]): RunRequest {
  return { contract_version: "1", source: doc.source, filename: doc.name, document_id: doc.id,
    revision: doc.revision, passes: doc.passes, pipeline, bindings };
}
export const requestKey = (request: RunRequest) => JSON.stringify(request);
export function sameRun(previous: Run | null, incoming: Run) {
  if (!previous || previous.id !== incoming.id || previous.document_id !== incoming.document_id || previous.revision !== incoming.revision || previous.source_hash !== incoming.source_hash) return false;
  for (const field of ["pipeline", "filename", "passes", "effective_passes", "bindings", "dataset_hashes"] as const)
    if (JSON.stringify(previous[field]) !== JSON.stringify(incoming[field])) return false;
  // Una respuesta GET iniciada antes de cancelar nunca puede resucitar el trabajo.
  if (!activeRun(previous) && incoming.state !== previous.state) return false;
  if (previous.state === "running" && incoming.state === "queued") return false;
  return !(previous.expired && !incoming.expired);
}
export function matchesRequest(request: RunRequest, run: Run, sourceHash: string) {
  return run.document_id === request.document_id && run.revision === request.revision && run.filename === request.filename &&
    run.source_hash === sourceHash && run.pipeline === request.pipeline && JSON.stringify(run.passes) === JSON.stringify(request.passes) &&
    JSON.stringify(run.bindings) === JSON.stringify(request.bindings);
}
export const stateLabel: Record<Run["state"], string> = {
  queued: "En cola", running: "Ejecutando", succeeded: "Completado", failed: "Fallido", cancelled: "Cancelado", timed_out: "Tiempo agotado",
};
export function cellText(value: unknown): string {
  if (value === null) return "NULL";
  if (record(value) && typeof value.kind === "string") return `${label(value.value)} (${value.kind})`;
  return String(value);
}
