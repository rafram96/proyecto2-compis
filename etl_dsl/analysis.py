"""API de análisis por texto, compartida por CLI, navegador y futuros servicios.

No escribe archivos, no lee conectores ni importa el runtime. Los errores del
programa son diagnósticos; las opciones inválidas del llamador lanzan ValueError.
"""
from dataclasses import dataclass
from hashlib import sha256
import json
from typing import Iterable, Literal

from .ast import to_dict
from .backend import CompileError, generate
from .diagnostics import Diagnostic, ParseError
from .ir import format_module, lower
from .parser import parse_tree
from .passes import DEFAULT, PASSES, optimize
from .scanner import scan
from .validation import validate
from .version import COMPILER_VERSION, CONTRACT_VERSION
from .visitor import ASTBuilder


ARTIFACTS = ("tokens", "tree", "ast", "ir_before", "ir_after", "python")
FORMATS = ("check", "tokens", "tree", "ast", "ir", "python")


@dataclass(frozen=True, slots=True)
class Artifact:
    status: Literal["not_requested", "available", "blocked"]
    data: object = None


@dataclass(frozen=True, slots=True)
class AnalysisResult:
    filename: str
    source_hash: str
    diagnostics: tuple[Diagnostic, ...]
    artifacts: dict[str, Artifact]
    passes: tuple[str, ...]
    applied_passes: tuple[str, ...]
    pipeline_count: int | None

    @property
    def ok(self) -> bool:
        return not any(d.severity == "error" for d in self.diagnostics)

    def to_dict(self) -> dict:
        """Todos los datos son JSON; no se exponen objetos Lark, AST o Polars."""
        return {
            "contract_version": CONTRACT_VERSION,
            "compiler_version": COMPILER_VERSION,
            "offset_encoding": "unicode-codepoints",
            "ok": self.ok,
            "filename": self.filename,
            "source_hash": self.source_hash,
            "diagnostics": [d.to_dict(self.filename) for d in self.diagnostics],
            "artifacts": {name: {"status": item.status, "data": item.data}
                          for name, item in self.artifacts.items()},
            "passes": list(self.passes),
            "applied_passes": list(self.applied_passes),
            "pipeline_count": self.pipeline_count,
        }


def _selection(values: Iterable[str], allowed: tuple | dict, label: str) -> tuple[str, ...]:
    if isinstance(values, str):
        raise ValueError(f"{label}: se esperaba una secuencia de nombres, no un texto.")
    selected = tuple(values)
    unknown = [name for name in selected if name not in allowed]
    if unknown:
        raise ValueError(f"{label} desconocidos: {unknown}; disponibles: {list(allowed)}.")
    return selected


def analyze(source: str, *, filename: str = "<string>", base_dir=".",
            passes: Iterable[str] | None = None,
            artifacts: Iterable[str] | None = None) -> AnalysisResult:
    """Analiza una vez; produce solo los artefactos solicitados y sus prerrequisitos.

    ``artifacts=None`` solicita todos; ``artifacts=()`` solo valida sintaxis y
    estructura. ``passes=None`` usa los predeterminados y ``passes=()`` es -O0.
    Los esquemas y tipos de datos todavía no se infieren estáticamente (C2).
    """
    selected = _selection(DEFAULT if passes is None else passes, PASSES, "Pases")
    requested = _selection(ARTIFACTS if artifacts is None else artifacts, ARTIFACTS, "Artefactos")
    results = {name: Artifact("blocked" if name in requested else "not_requested") for name in ARTIFACTS}
    diagnostics: tuple[Diagnostic, ...] = ()
    applied: tuple[str, ...] = ()
    pipeline_count = None

    def finish():
        return AnalysisResult(str(filename), sha256(source.encode("utf-8")).hexdigest(),
                              diagnostics, results, selected, applied, pipeline_count)

    def available(name, data):
        if name in requested:
            results[name] = Artifact("available", data)

    # La inspección léxica usa el lexer básico; el parser sigue siendo contextual.
    # Validar esta fase siempre mantiene el mismo diagnóstico entre selecciones.
    try:
        tokens = scan(source, filename=str(filename))
    except ParseError as exc:
        diagnostics = (exc.diagnostic,)
        return finish()
    if "tokens" in requested:
        available("tokens", [to_dict(token) for token in tokens])

    try:
        tree = parse_tree(source, filename=str(filename))
    except ParseError as exc:
        diagnostics = (exc.diagnostic,)
        return finish()
    if "tree" in requested:
        available("tree", tree.pretty())
    program = ASTBuilder().transform(tree)
    pipeline_count = len(program.pipelines)
    if "ast" in requested:
        available("ast", to_dict(program))

    diagnostics = validate(program)
    if diagnostics:
        return finish()

    if not {"ir_before", "ir_after", "python"}.intersection(requested):
        return finish()
    before = lower(program)
    if "ir_before" in requested:
        available("ir_before", {"module": to_dict(before), "text": format_module(before)})
    if not {"ir_after", "python"}.intersection(requested):
        return finish()
    after = optimize(before, selected)
    applied = selected
    if "ir_after" in requested:
        available("ir_after", {"module": to_dict(after), "text": format_module(after)})
    if "python" in requested:
        try:
            available("python", generate(after, filename=filename, base_dir=base_dir))
        except CompileError as exc:
            diagnostics = (exc.diagnostic or Diagnostic(
                "E_CODEGEN", str(exc), program.span, phase="backend"),)
    return finish()


def artifacts_for_format(fmt: str) -> tuple[str, ...]:
    """Selección de artefactos para los seis formatos históricos de la CLI."""
    if fmt not in FORMATS:
        raise ValueError(f"Formato desconocido: {fmt}.")
    return () if fmt == "check" else ("ir_before", "ir_after") if fmt == "ir" else (fmt,)


def format_output(result: AnalysisResult, fmt: str) -> str:
    """Presentación de un artefacto disponible, incluso en un análisis parcial."""
    artifacts_for_format(fmt)

    def data(name):
        artifact = result.artifacts[name]
        if artifact.status != "available":
            raise ValueError(f"Artefacto {name} no disponible: {artifact.status}.")
        return artifact.data

    if fmt == "check":
        if not result.ok:
            raise ValueError("El programa contiene errores de análisis.")
        return f"OK: {result.filename}: {result.pipeline_count} pipeline(s); sintaxis y estructura válidas.\n"
    if fmt == "ir":
        before = data("ir_before")["text"]
        if not result.applied_passes:
            return before
        return (f"// IR antes de optimizar\n{before}\n"
                f"// IR después de: {', '.join(result.applied_passes)}\n{data('ir_after')['text']}")
    value = data(fmt)
    if fmt in {"tokens", "ast"}:
        return json.dumps(value, ensure_ascii=True, indent=2) + "\n"
    return value


def format_diagnostics(result: AnalysisResult, source: str) -> str:
    """Diagnósticos de consola; el contrato web no necesita analizar este texto."""
    text = "".join(d.format(source, result.filename) + "\n" for d in result.diagnostics)
    if any(d.phase == "semantic" for d in result.diagnostics):
        text += f"{result.filename}: {len(result.diagnostics)} error(es) de validación.\n"
    return text
