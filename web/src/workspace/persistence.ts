import {
  byteLength,
  MAX_DRAFTS,
  MAX_SOURCE,
  PASSES,
  FORMATS,
} from "./model.ts";
import type { Document, Workspace } from "./model.ts";
export const STORAGE_KEY = "cauce-workspace-v1";
export const MAX_STORAGE = 512 * 1024;
type StoragePort = Pick<Storage, "getItem" | "setItem">;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function document(v: unknown): v is Document {
  if (!object(v)) return false;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    v.id.length <= 80 &&
    typeof v.name === "string" &&
    v.name.length > 0 &&
    v.name.length <= 104 &&
    !/[\\/\u0000-\u001f]/.test(v.name) &&
    typeof v.source === "string" &&
    byteLength(v.source) <= MAX_SOURCE &&
    Number.isSafeInteger(v.revision) &&
    Number(v.revision) >= 1 &&
    (v.passes === null ||
      (Array.isArray(v.passes) &&
        v.passes.length <= PASSES.length &&
        v.passes.every((p) => typeof p === "string" && PASSES.includes(p)) &&
        new Set(v.passes).size === v.passes.length)) &&
    FORMATS.some(([f]) => f === v.inspector)
  );
}
/** Reconstruye solo los campos admitidos: no persiste resultados, datasets ni claves desconocidas. */
function copy(d: Document): Document {
  return {
    id: d.id,
    name: d.name,
    source: d.source,
    revision: d.revision,
    passes: d.passes === null ? null : [...d.passes],
    inspector: d.inspector,
  };
}
export function decode(raw: string): Workspace {
  if (byteLength(raw) > MAX_STORAGE)
    throw new Error("El almacenamiento supera 512 KiB.");
  const v: unknown = JSON.parse(raw);
  if (!object(v) || v.version !== 1)
    throw new Error("Versión de borrador incompatible.");
  if (
    !document(v.active) ||
    !Array.isArray(v.drafts) ||
    v.drafts.length > MAX_DRAFTS ||
    !v.drafts.every(document)
  )
    throw new Error("El borrador guardado está dañado.");
  const ids = [v.active, ...v.drafts].map((d) => d.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Identificadores de borrador duplicados.");
  return { version: 1, active: copy(v.active), drafts: v.drafts.map(copy) };
}
export function readWorkspace(
  storage: StoragePort | undefined,
  fallback: Workspace,
) {
  try {
    if (!storage) throw new Error("Almacenamiento local no disponible.");
    const raw = storage.getItem(STORAGE_KEY);
    return {
      workspace: raw ? decode(raw) : fallback,
      notice: raw
        ? "Borrador restaurado en este navegador."
        : "Borrador nuevo. Se guardará al editar.",
      saved: !!raw,
    };
  } catch (error) {
    return {
      workspace: fallback,
      notice: `${error instanceof Error ? error.message : "No se pudo restaurar el borrador."} Puedes editar y descargar el documento.`,
      saved: false,
    };
  }
}
export function writeWorkspace(
  storage: StoragePort | undefined,
  workspace: Workspace,
) {
  try {
    const raw = JSON.stringify({
      version: 1,
      active: copy(workspace.active),
      drafts: workspace.drafts.map(copy),
    });
    decode(raw);
    if (!storage) throw new Error("Almacenamiento local no disponible.");
    storage.setItem(STORAGE_KEY, raw);
    return { notice: "Guardado en este navegador.", saved: true };
  } catch (error) {
    return {
      notice: `Sin guardar: ${error instanceof Error ? error.message : "almacenamiento sin espacio o no disponible."} El documento sigue en memoria; descárgalo antes de salir.`,
      saved: false,
    };
  }
}
