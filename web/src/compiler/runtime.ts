import type { CompileRequest, CompileResult, RuntimeStatus } from "./types.ts";

export type RuntimeState = { status: RuntimeStatus; detail: string };
type Job = {
  request: CompileRequest;
  resolve(value: CompileResult): void;
  reject(error: Error): void;
};
type Channel = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror"
>;
export class SupersededError extends Error {
  constructor() {
    super("Solicitud sustituida por una edición posterior.");
  }
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";
function validResult(v: unknown): v is CompileResult {
  if (
    !record(v) ||
    typeof v.ok !== "boolean" ||
    typeof v.out !== "string" ||
    typeof v.err !== "string" ||
    !record(v.analysis)
  )
    return false;
  const a = v.analysis;
  if (
    a.contract_version !== "4" ||
    a.offset_encoding !== "unicode-codepoints" ||
    typeof a.source_hash !== "string" ||
    !Array.isArray(a.diagnostics) ||
    !record(a.artifacts)
  )
    return false;
  if (
    !a.diagnostics.every(
      (d) =>
        record(d) &&
        typeof d.code === "string" &&
        typeof d.message === "string" &&
        ["error", "warning", "info"].includes(String(d.severity)) &&
        record(d.span) &&
        ["line", "column", "end_line", "end_column", "start", "end"].every(
          (k) => Number.isInteger((d.span as Record<string, unknown>)[k]),
        ),
    )
  )
    return false;
  for (const key of [
    "tokens",
    "tree",
    "ast",
    "ir_before",
    "ir_after",
    "python",
    "schemas",
  ]) {
    const artifact = a.artifacts[key];
    if (
      !record(artifact) ||
      !["available", "not_requested", "blocked"].includes(
        String(artifact.status),
      )
    )
      return false;
    if (
      artifact.status === "available"
        ? artifact.data == null
        : artifact.data !== null
    )
      return false;
    if (
      key === "python" &&
      artifact.status === "available" &&
      typeof artifact.data !== "string"
    )
      return false;
  }
  return (
    v.views === undefined ||
    (record(v.views) &&
      ["check", "tokens", "tree", "ast", "ir", "python"].every(
        (k) => typeof (v.views as Record<string, unknown>)[k] === "string",
      ))
  );
}

/** Una solicitud en curso y una pendiente; todas las promesas terminan, incluso tras reinicio. */
export class CompilerRuntime {
  state: RuntimeState = { status: "idle", detail: "" };
  private listeners = new Set<() => void>();
  private channel: Channel | null = null;
  private active: Job | null = null;
  private queued: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sequence = 0;
  private factory: () => Channel;
  private limits: { load: number; compile: number };
  constructor(
    factory: () => Channel,
    limits = { load: 60_000, compile: 12_000 },
  ) {
    this.factory = factory;
    this.limits = limits;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private set(state: RuntimeState) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }
  private deadline(loading: boolean) {
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        this.fail(
          new Error(
            loading
              ? "La carga de Python superó 60 s. Reinicia para reintentar la descarga."
              : "La compilación superó 12 s. Reinicia el compilador y revisa el programa.",
          ),
        ),
      loading ? this.limits.load : this.limits.compile,
    );
  }
  private fail(error: Error) {
    clearTimeout(this.timer);
    const channel = this.channel;
    this.channel = null; // Invalida primero los callbacks del worker anterior.
    channel?.terminate();
    this.active?.reject(error);
    this.queued?.reject(error);
    this.active = this.queued = null;
    this.set({ status: "error", detail: error.message });
  }
  restart = () => {
    this.fail(new Error("Compilador reiniciado. El documento se conserva."));
    this.set({
      status: "idle",
      detail: "Compilador reiniciado. Pulsa Compilar para cargar Python.",
    });
  };
  private connect() {
    const channel = this.factory();
    this.channel = channel;
    this.set({ status: "loading", detail: "Preparando el compilador…" });
    channel.onerror = (event) => {
      event.preventDefault();
      if (this.channel === channel)
        this.fail(
          new Error(
            "Falló el worker. Reinicia el compilador para recuperarlo.",
          ),
        );
    };
    channel.onmessageerror = () => {
      if (this.channel === channel)
        this.fail(
          new Error(
            "No se pudo leer el mensaje del worker. Reinicia el compilador.",
          ),
        );
    };
    channel.onmessage = (event) => {
      if (this.channel !== channel) return;
      const m: unknown = event.data;
      if (!record(m))
        return this.fail(new Error("Mensaje inválido del compilador."));
      if (m.type === "status") {
        if (
          !["loading", "ready", "error"].includes(String(m.status)) ||
          typeof m.detail !== "string"
        )
          return this.fail(new Error("Estado inválido del compilador."));
        if (m.status === "error") return this.fail(new Error(m.detail));
        // El progreso no extiende indefinidamente el tiempo máximo de carga.
        if (
          m.status === "ready" &&
          this.state.status !== "ready" &&
          this.active
        )
          this.deadline(false);
        if (this.state.status === "ready" && m.status === "loading")
          return this.fail(new Error("Secuencia inválida del compilador."));
        this.set({ status: m.status as RuntimeStatus, detail: m.detail });
      } else if (m.type === "result" || m.type === "failure") {
        if (!Number.isInteger(m.id))
          return this.fail(new Error("Identificador inválido del compilador."));
        const job = this.active;
        if (!job || m.id !== job.request.id) return; // Duplicado o respuesta obsoleta.
        if (m.type === "failure")
          return this.fail(
            new Error(
              typeof m.message === "string"
                ? m.message
                : "Falló la compilación local.",
            ),
          );
        if (!validResult(m.result))
          return this.fail(
            new Error(
              "Respuesta incompatible o inválida del compilador (se requiere contrato 4).",
            ),
          );
        if (job.request.allArtifacts && !m.result.views)
          return this.fail(
            new Error("Faltan las vistas del estudio en la respuesta."),
          );
        clearTimeout(this.timer);
        job.resolve(m.result);
        this.active = null;
        if (this.queued) {
          const job = this.queued;
          this.queued = null;
          this.send(job);
        }
      } else this.fail(new Error("Mensaje desconocido del compilador."));
    };
  }
  private send(job: Job) {
    this.active = job;
    try {
      if (!this.channel) this.connect();
      this.deadline(this.state.status !== "ready");
      this.channel!.postMessage(job.request);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  compile = (request: Omit<CompileRequest, "id">): Promise<CompileResult> =>
    new Promise((resolve, reject) => {
      const job = {
        request: { ...request, id: ++this.sequence },
        resolve,
        reject,
      };
      if (this.active) {
        this.queued?.reject(new SupersededError());
        this.queued = job;
      } else this.send(job);
    });
}
