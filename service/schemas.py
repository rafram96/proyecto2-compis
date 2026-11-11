from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from etl_dsl.passes import PASSES

HTTP_VERSION = '1'
State = Literal['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out']
ACTIVE = {'queued', 'running'}


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Binding(Model):
    pipeline: str = Field(min_length=1, max_length=100)
    declaration: str = Field(min_length=1, max_length=100)
    dataset_id: str = Field(min_length=1, max_length=100)
    version: str = Field(min_length=1, max_length=100)


class RunRequest(Model):
    contract_version: Literal['1'] = '1'
    source: str = Field(min_length=1, max_length=128 * 1024)
    filename: str = Field(min_length=1, max_length=100, pattern=r'^[^/\\\x00-\x1f]+$')
    document_id: str = Field(min_length=1, max_length=100)
    revision: int = Field(ge=1, le=2**53 - 1)
    pipeline: str = Field(min_length=1, max_length=100)
    passes: list[str] | None = Field(default=None, max_length=20)
    bindings: list[Binding] = Field(max_length=64)

    @field_validator('source')
    @classmethod
    def source_size(cls, value):
        if len(value.encode('utf-8')) > 128 * 1024:
            raise ValueError('El fuente supera 128 KiB.')
        return value

    @field_validator('passes')
    @classmethod
    def passes_valid(cls, value):
        if value is not None and any(p not in PASSES for p in value):
            raise ValueError('Pases desconocidos.')
        return value


class Span(Model):
    line: int
    column: int
    end_line: int
    end_column: int
    start: int
    end: int


class Diagnostic(Model):
    phase: str
    code: str
    severity: str
    message: str
    filename: str
    span: Span | None = None


class Column(Model):
    name: str
    dtype: str
    nullable: bool  # Nulos observados en la salida materializada; no garantía de futuros datos.
    declared_nullable: bool | None = None


class Artifact(Model):
    id: str
    name: str
    media_type: str
    bytes: int


class Output(Model):
    id: str
    pipeline: str
    declaration: str
    kind: Literal['SINK', 'OUTPUT']
    rows: int
    columns: list[Column]
    artifact_id: str


class Metrics(Model):
    worker_seconds: float | None = None
    peak_rss_bytes: int | None = None
    rss_sample_ms: int = 50


class Run(Model):
    contract_version: Literal['1'] = '1'
    compiler_version: str
    analysis_version: str
    id: str
    status_url: str
    state: State
    document_id: str
    revision: int
    filename: str
    source_hash: str
    pipeline: str
    passes: list[str] | None
    effective_passes: list[str]
    bindings: list[Binding]
    dataset_hashes: dict[str, str]
    created_at: float
    started_at: float | None = None
    finished_at: float | None = None
    expires_at: float | None = None
    expired: bool = False
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    outputs: list[Output] = Field(default_factory=list)
    artifacts: list[Artifact] = Field(default_factory=list)
    metrics: Metrics = Field(default_factory=Metrics)


class Dataset(Model):
    id: str
    version: str
    title: str
    driver: str
    options: dict[str, str | bool]
    available: bool
    sha256: str | None
    bytes: int | None


class Capabilities(Model):
    contract_version: Literal['1'] = '1'
    compiler_version: str
    analysis_version: str
    passes: list[str]
    default_passes: list[str]
    source_connectors: list[str]
    sink_connectors: list[str]
    datasets: list[Dataset]
    limits: dict[str, int | float]
    isolation: str


class Health(Model):
    status: Literal['ok'] = 'ok'
    contract_version: Literal['1'] = '1'


class TaggedValue(Model):
    kind: Literal['non_finite', 'binary', 'duration']
    value: str


class Preview(Model):
    output_id: str
    offset: int
    limit: int
    total_rows: int
    columns: list[Column]
    rows: list[list[str | int | float | bool | None | TaggedValue]]
