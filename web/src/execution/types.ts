// Generado por web/scripts/gen_http.py desde FastAPI; no editar.
export type Artifact = {
  "id": string;
  "name": string;
  "media_type": string;
  "bytes": number;
};

export type Binding = {
  "pipeline": string;
  "declaration": string;
  "dataset_id": string;
  "version": string;
};

export type Capabilities = {
  "contract_version"?: "1";
  "compiler_version": string;
  "analysis_version": string;
  "passes": Array<string>;
  "default_passes": Array<string>;
  "source_connectors": Array<string>;
  "sink_connectors": Array<string>;
  "datasets": Array<Dataset>;
  "limits": Record<string, (number | number)>;
  "isolation": string;
};

export type Column = {
  "name": string;
  "dtype": string;
  "nullable": boolean;
  "declared_nullable"?: (boolean | null);
};

export type Dataset = {
  "id": string;
  "version": string;
  "title": string;
  "driver": string;
  "options": Record<string, (string | boolean)>;
  "available": boolean;
  "sha256": (string | null);
  "bytes": (number | null);
};

export type Diagnostic = {
  "phase": string;
  "code": string;
  "severity": string;
  "message": string;
  "filename": string;
  "span"?: (Span | null);
};

export type HTTPValidationError = {
  "detail"?: Array<ValidationError>;
};

export type Health = {
  "status"?: "ok";
  "contract_version"?: "1";
};

export type Metrics = {
  "worker_seconds"?: (number | null);
  "peak_rss_bytes"?: (number | null);
  "rss_sample_ms"?: number;
};

export type Output = {
  "id": string;
  "pipeline": string;
  "declaration": string;
  "kind": "SINK" | "OUTPUT";
  "rows": number;
  "columns": Array<Column>;
  "artifact_id": string;
};

export type Preview = {
  "output_id": string;
  "offset": number;
  "limit": number;
  "total_rows": number;
  "columns": Array<Column>;
  "rows": Array<Array<(string | number | number | boolean | TaggedValue | null)>>;
};

export type Run = {
  "contract_version"?: "1";
  "compiler_version": string;
  "analysis_version": string;
  "id": string;
  "status_url": string;
  "state": "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  "document_id": string;
  "revision": number;
  "filename": string;
  "source_hash": string;
  "pipeline": string;
  "passes": (Array<string> | null);
  "effective_passes": Array<string>;
  "bindings": Array<Binding>;
  "dataset_hashes": Record<string, string>;
  "created_at": number;
  "started_at"?: (number | null);
  "finished_at"?: (number | null);
  "expires_at"?: (number | null);
  "expired"?: boolean;
  "diagnostics"?: Array<Diagnostic>;
  "outputs"?: Array<Output>;
  "artifacts"?: Array<Artifact>;
  "metrics"?: Metrics;
};

export type RunRequest = {
  "contract_version"?: "1";
  "source": string;
  "filename": string;
  "document_id": string;
  "revision": number;
  "pipeline": string;
  "passes"?: (Array<string> | null);
  "bindings": Array<Binding>;
};

export type Span = {
  "line": number;
  "column": number;
  "end_line": number;
  "end_column": number;
  "start": number;
  "end": number;
};

export type TaggedValue = {
  "kind": "non_finite" | "binary" | "duration";
  "value": string;
};

export type ValidationError = {
  "loc": Array<(string | number)>;
  "msg": string;
  "type": string;
  "input"?: unknown;
  "ctx"?: Record<string, unknown>;
};
