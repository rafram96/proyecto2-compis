export type Format = "check" | "tokens" | "tree" | "ast" | "ir" | "python";

export type CompileResult = { ok: boolean; out: string; err: string };

/** `passes: null` usa los pases por defecto; `[]` equivale a -O0. */
export type CompileRequest = { id: number; source: string; name: string; fmt: Format; passes: string[] | null };

export type RuntimeStatus = "idle" | "loading" | "ready" | "error";

export type WorkerMessage =
  | { type: "status"; status: RuntimeStatus; detail: string }
  | { type: "result"; id: number; result: CompileResult }
  | { type: "failure"; id: number; message: string };
