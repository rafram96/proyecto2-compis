import { useSyncExternalStore } from "react";
import { CompilerRuntime } from "./runtime";
export { SupersededError } from "./runtime";

const runtime = new CompilerRuntime(
  () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
);
export const compile = runtime.compile;
export const restartCompiler = runtime.restart;
export function useRuntime() {
  return useSyncExternalStore(runtime.subscribe, runtime.snapshot);
}
