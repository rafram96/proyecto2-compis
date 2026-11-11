import { useSyncExternalStore } from "react";
import { programs } from "../data";
import { createDocument, replaceDocument, revise } from "./model";
import type { Document } from "./model";
import { readWorkspace, writeWorkspace } from "./persistence";
const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};
let state = readWorkspace(storage(), {
  version: 1,
  active: createDocument("ventas.etl", programs["ventas.etl"].source),
  drafts: [],
});
const listeners = new Set<() => void>();
let unsavedChanges = false;
function emit() {
  listeners.forEach((l) => l());
}
function save(workspace: typeof state.workspace) {
  state = { workspace, ...writeWorkspace(storage(), workspace) };
  unsavedChanges = !state.saved;
  emit();
}
export const getWorkspace = () => state;
export function updateDocument(change: Parameters<typeof revise>[1]) {
  save({ ...state.workspace, active: revise(state.workspace.active, change) });
}
export function openDocument(next: Document) {
  save(replaceDocument(state.workspace, next));
}
export function removeDraft(id: string) {
  save({
    ...state.workspace,
    drafts: state.workspace.drafts.filter((d) => d.id !== id),
  });
}
export function useWorkspace() {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, getWorkspace);
}
// Avisa también si se sale desde el landing tras una navegación interna con almacenamiento fallido.
window.addEventListener("beforeunload", (event) => {
  if (unsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});
