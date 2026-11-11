import { useSyncExternalStore } from "react";
import type { CompileRequest, CompileResult, RuntimeStatus, WorkerMessage } from "./types";

type State = { status: RuntimeStatus; detail: string };

let worker: Worker | null = null;
let seq = 0;
let state: State = { status: "idle", detail: "" };
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve(r: CompileResult): void; reject(e: Error): void }>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.type === "status") set({ status: m.status, detail: m.detail });
    else if (m.type === "result") pending.get(m.id)?.resolve(m.result);
    else pending.get(m.id)?.reject(new Error(m.message));
    if (m.type !== "status") pending.delete(m.id);
  };
  return worker;
}

/** Compila con el etl_dsl real dentro de un Web Worker (la primera llamada descarga Pyodide). */
export function compile(req: Omit<CompileRequest, "id">): Promise<CompileResult> {
  const id = ++seq;
  if (state.status === "idle" || state.status === "error") set({ status: "loading", detail: "Preparando el compilador…" });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id } satisfies CompileRequest);
  });
}

export function useRuntime(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
