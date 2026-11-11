import { useCallback, useEffect, useRef, useState } from "react";
import { compile, SupersededError, useRuntime } from "../compiler/client";
import { acceptResult, isCurrent } from "./model";
import type { Document, DocumentResult } from "./model";

export function useCompilation(document: Document) {
  const runtime = useRuntime();
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(document);
  latest.current = document;
  const ticket = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ticket.current++;
    };
  }, []);
  const run = useCallback(async () => {
    const doc = latest.current;
    const request = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      const compiled = await compile({
        source: doc.source,
        name: doc.name,
        passes: doc.passes,
        fmt: "check",
        allArtifacts: true,
      });
      if (mounted.current && request === ticket.current)
        setResult((previous) =>
          acceptResult(latest.current, previous, {
            documentId: doc.id,
            revision: doc.revision,
            passes: doc.passes,
            result: compiled,
          }),
        );
    } catch (error) {
      if (
        mounted.current &&
        request === ticket.current &&
        !(error instanceof SupersededError)
      )
        setError(String(error instanceof Error ? error.message : error));
    } finally {
      if (mounted.current && request === ticket.current) setBusy(false);
    }
  }, []);
  const current = isCurrent(document, result);
  // La selección del inspector no forma parte de esta dependencia: ya se pidieron todas las vistas.
  useEffect(() => {
    if (runtime.status !== "ready" || current || busy) return;
    const timer = setTimeout(run, 320);
    return () => clearTimeout(timer);
  }, [document.id, document.revision, runtime.status, current, busy, run]);
  return {
    runtime,
    result: result?.documentId === document.id ? result : null,
    current,
    busy,
    error,
    run,
  };
}
