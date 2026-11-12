import type { Capabilities, Preview, Run, RunRequest } from "./types.ts";
import { record } from "../components/inspectors/model.ts";

async function json(path: string, init: RequestInit = {}) {
  try {
    const response = await fetch(`/api/v1${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) {
      if (response.status >= 500)
        throw new Error(`Servicio de ejecución no disponible (HTTP ${response.status}). Puedes usar Compile y los inspectores; pulsa Reconectar para volver a consultar.`);
      const error = await response.json().catch(() => null);
      const detail = record(error) && typeof error.detail === "string" ? error.detail : "La solicitud no es válida para el servicio.";
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    return await response.json() as unknown;
  } catch (e) {
    if (e instanceof Error && (e.message.startsWith("HTTP ") || e.message.startsWith("Servicio de ejecución"))) throw e;
    throw new Error("Servicio desconectado o sin respuesta. Puedes seguir editando y compilando localmente. Pulsa Reconectar para consultar de nuevo.");
  }
}
const named = (value: unknown, keys: string[]) => record(value) && keys.every((k) => typeof value[k] === "string");
const bindingsValid = (value: unknown) => Array.isArray(value) && value.every((b) => named(b, ["pipeline", "declaration", "dataset_id", "version"]));
const columnsValid = (value: unknown) => Array.isArray(value) && value.every((c) => named(c, ["name", "dtype"]) && record(c) && typeof c.nullable === "boolean");
export function decodeCapabilities(value: unknown): Capabilities {
  if (!record(value) || value.contract_version !== "1" || value.analysis_version !== "4" || value.compiler_version !== "0.1.0" || !Array.isArray(value.datasets) || !value.datasets.every((d) => named(d, ["id", "version", "title", "driver"]) && record(d) && typeof d.available === "boolean" && record(d.options)) || !Array.isArray(value.default_passes) || !value.default_passes.every((p) => typeof p === "string") || !record(value.limits) || !["timeout_seconds", "memory_bytes", "ttl_seconds"].every((k) => record(value.limits) && typeof value.limits[k] === "number" && Number.isFinite(value.limits[k]) && Number(value.limits[k]) > 0))
    throw new Error("Servicio incompatible. Actualiza web y API desde la misma revisión; la compilación local sigue disponible.");
  return value as Capabilities;
}
export function decodeRun(value: unknown): Run {
  if (!record(value) || value.contract_version !== "1" || value.analysis_version !== "4" || typeof value.id !== "string" || !/^[a-f0-9]{32}$/.test(value.id) || typeof value.document_id !== "string" || !Number.isSafeInteger(value.revision) || typeof value.source_hash !== "string" || !["queued", "running", "succeeded", "failed", "cancelled", "timed_out"].includes(String(value.state)) || !Array.isArray(value.outputs) || !value.outputs.every((o) => named(o, ["id", "pipeline", "declaration", "artifact_id"]) && record(o) && Number.isSafeInteger(o.rows) && columnsValid(o.columns)) || !Array.isArray(value.artifacts) || !value.artifacts.every((a) => named(a, ["id", "name", "media_type"]) && record(a) && Number.isSafeInteger(a.bytes)) || !bindingsValid(value.bindings) || !Array.isArray(value.diagnostics) || !value.diagnostics.every((d) => named(d, ["code", "message", "phase"])))
    throw new Error("Respuesta de ejecución incompatible.");
  return value as Run;
}
export const capabilities = async () => decodeCapabilities(await json("/capabilities"));
export const submit = async (request: RunRequest) => decodeRun(await json("/runs", { method: "POST", body: JSON.stringify(request) }));
export const getRun = async (id: string, signal?: AbortSignal) => decodeRun(await json(`/runs/${encodeURIComponent(id)}`, { signal }));
export const cancelRun = async (id: string) => decodeRun(await json(`/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }));
export async function preview(id: string, output: string, offset: number, signal: AbortSignal): Promise<Preview> {
  const value = await json(`/runs/${encodeURIComponent(id)}/outputs/${encodeURIComponent(output)}/preview?offset=${offset}&limit=100`, { signal });
  if (!record(value) || value.output_id !== output || value.offset !== offset || !Array.isArray(value.rows) || !value.rows.every((r) => Array.isArray(r) && r.every((c) => c === null || ["string", "number", "boolean"].includes(typeof c) || named(c, ["kind", "value"]))) || !columnsValid(value.columns)) throw new Error("Vista previa incompatible.");
  return value as Preview;
}
export const artifactUrl = (id: string, artifact: string) => `/api/v1/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}`;
