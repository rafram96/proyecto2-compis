export type Format = "check" | "tokens" | "tree" | "ast" | "ir" | "python";

/** Python cuenta caracteres Unicode; el editor usa unidades UTF-16. Fin exclusivo. */
export type Span = { line: number; column: number; end_line: number; end_column: number; start: number; end: number };

export type Diagnostic = {
  code: string;
  message: string;
  filename: string;
  phase: "lexical" | "syntax" | "semantic" | "backend";
  severity: "error" | "warning" | "info";
  span: Span;
};

export type Artifact<T = unknown> =
  | { status: "available"; data: T }
  | { status: "not_requested" | "blocked"; data: null };

export type InferredColumn = { name: string; types: string[] | null; nullable: boolean };
export type InferredSchema = { complete: boolean; absent: string[]; columns: InferredColumn[] };
/** Pipeline → nodo → puerto ("" para salida ordinaria). Esquemas de la IR original. */
export type InferredSchemas = Record<string, Record<string, Record<string, InferredSchema>>>;

export type AnalysisResult = {
  contract_version: "3";
  compiler_version: string;
  offset_encoding: "unicode-codepoints";
  ok: boolean;
  filename: string;
  source_hash: string;
  diagnostics: Diagnostic[];
  artifacts: {
    tokens: Artifact<{ kind: string; lexeme: string; span: Span }[]>;
    tree: Artifact<string>;
    ast: Artifact;
    ir_before: Artifact<{ module: unknown; text: string }>;
    ir_after: Artifact<{ module: unknown; text: string }>;
    python: Artifact<string>;
    schemas: Artifact<InferredSchemas>;
  };
  passes: string[];
  applied_passes: string[];
  pipeline_count: number | null;
};

/** `analysis: null` solo representa un fallo de transporte/carga, no del DSL. */
export type CompilePresentation = {
  ok: boolean;
  out: string;
  err: string;
  analysis: Omit<AnalysisResult, "artifacts"> | null;
};

/** Los resultados en vivo incluyen artefactos; el landing solo precarga su presentación. */
export type CompileResult = CompilePresentation & { analysis: AnalysisResult | null };

/** `passes: null` usa los pases por defecto; `[]` equivale a -O0. */
export type CompileRequest = { id: number; source: string; name: string; fmt: Format; passes: string[] | null };

export type RuntimeStatus = "idle" | "loading" | "ready" | "error";

export type WorkerMessage =
  | { type: "status"; status: RuntimeStatus; detail: string }
  | { type: "result"; id: number; result: CompileResult }
  | { type: "failure"; id: number; message: string };
