import { useSyncExternalStore } from "react";
import type { Run } from "./types";
import type { Selection } from "./model";
import { sameRun } from "./model";

type Session = { selection: Selection; run: Run | null; key: string; pending: boolean; error: string };
const empty: Session = { selection: { pipeline: "", datasets: {} }, run: null, key: "", pending: false, error: "" };
const sessions = new Map<string, Session>();
const listeners = new Set<() => void>();
export const session = (doc: string) => sessions.get(doc) ?? empty;
export function updateSession(doc: string, update: Partial<Session>) {
  sessions.set(doc, { ...session(doc), ...update });
  listeners.forEach((l) => l());
}
export function receiveRun(doc: string, incoming: Run) {
  const current = session(doc);
  if (sameRun(current.run, incoming)) updateSession(doc, { run: incoming, error: "" });
}
export function useSession(doc: string) {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => session(doc));
}
