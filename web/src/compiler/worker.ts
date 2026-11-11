/// <reference lib="webworker" />
/**
 * El compilador real (paquete etl_dsl) corriendo en el navegador con Pyodide.
 * Solo necesita lark + la biblioteca estándar: Polars y DuckDB se usan al ejecutar, no al compilar.
 * Se carga la primera vez que alguien pulsa «Compilar»; hasta entonces la página muestra la salida precalculada.
 */
import studioSrc from "./studio.py?raw";
import type { CompileRequest, WorkerMessage } from "./types";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const LARK_WHEEL = "py/lark-1.3.1-py3-none-any.whl";

// Fuentes del compilador, empaquetadas tal cual desde ../../../etl_dsl.
const SOURCES = import.meta.glob("../../../etl_dsl/*.{py,lark}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

type PyProxy = { toJs(o?: object): unknown; destroy(): void };
type Pyodide = {
  loadPackage(name: string): Promise<void>;
  pyimport(name: string): { install(url: string): Promise<void> };
  runPython(code: string): unknown;
  toPy(v: unknown): unknown;
  FS: { mkdirTree(p: string): void; writeFile(p: string, data: string): void };
};

const post = (m: WorkerMessage) => (self as DedicatedWorkerGlobalScope).postMessage(m);

let boot: Promise<{ py: Pyodide; compile: (...a: unknown[]) => PyProxy }> | null = null;

async function start() {
  post({ type: "status", status: "loading", detail: "Descargando Python 3.14 (Pyodide)…" });
  const { loadPyodide } = (await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)) as {
    loadPyodide(o: object): Promise<Pyodide>;
  };
  const py = await loadPyodide({ indexURL: PYODIDE });

  post({ type: "status", status: "loading", detail: "Instalando lark 1.3.1…" });
  await py.loadPackage("micropip");
  await py.pyimport("micropip").install(new URL(LARK_WHEEL, new URL(import.meta.env.BASE_URL, self.location.origin)).href);

  post({ type: "status", status: "loading", detail: "Cargando etl_dsl…" });
  py.FS.mkdirTree("/home/pyodide/etl_dsl");
  py.FS.mkdirTree("/work");
  for (const [path, text] of Object.entries(SOURCES)) {
    py.FS.writeFile(`/home/pyodide/etl_dsl/${path.split("/").pop()}`, text);
  }
  py.FS.writeFile("/home/pyodide/studio.py", studioSrc);
  py.runPython(`import os, sys\nsys.path.insert(0, "/home/pyodide")\nos.chdir("/work")`);
  const compile = py.runPython("from studio import compile_etl\ncompile_etl") as (...a: unknown[]) => PyProxy;
  const version = String(py.runPython("import sys, lark; f'Python {sys.version.split()[0]} · lark {lark.__version__}'"));
  post({ type: "status", status: "ready", detail: version });
  return { py, compile };
}

self.onmessage = async (e: MessageEvent<CompileRequest>) => {
  const { id, source, name, fmt, passes } = e.data;
  let runtime;
  try {
    boot ??= start();
    runtime = await boot;
  } catch (err) {
    // Falló la carga (red, CDN): se podrá reintentar con el próximo «Compilar».
    boot = null;
    post({ type: "status", status: "error", detail: String(err).split("\n")[0] });
    post({ type: "failure", id, message: String(err) });
    return;
  }
  try {
    const { py, compile } = runtime;
    // `undefined` llega a Python como None (los pases por defecto); `null` llegaría como JsNull.
    const res = compile(source, name, fmt, passes === null ? undefined : py.toPy(passes));
    const out = res.toJs({ dict_converter: Object.fromEntries }) as { ok: boolean; out: string; err: string };
    res.destroy();
    post({ type: "result", id, result: out });
  } catch (err) {
    post({ type: "failure", id, message: String(err) });
  }
};
