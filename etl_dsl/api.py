"""API del compilador para el entorno web: texto del programa -> diccionario JSON.

Los errores del programa nunca se lanzan como excepciones: se devuelven como
diagnósticos con su posición, junto con todo lo que las fases anteriores
alcanzaron a producir (AST, IR, esquemas). Así el editor puede marcar errores
y seguir mostrando el AST o el grafo mientras el programa está incompleto.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
import io
import math
import re
import tokenize

import polars as pl

from . import ir
from .ast import to_dict
from .backend import CompileError, generate
from .diagnostics import Diagnostic, ParseError
from .parser import parse
from .passes import DEFAULT, PASSES, optimize
from .runtime import ExecutionError, PolarsRuntime, run_pipelines
from .token import Span
from .typecheck import TypeInfo, check
from .validation import validate

FILENAME = "programa.etl"
# Las etiquetas del código generado empiezan con "archivo:línea:columna pipeline.nodo: ".
_LABEL = re.compile(r"^(?P<file>.+?):(?P<line>\d+):(?P<column>\d+) (?P<where>\S+): "
                    r"(?:(?P<code>E_[A-Z_]+): )?(?P<message>.*)$", re.DOTALL)


def _span(span: Span) -> dict:
    return {"start": {"line": span.line, "column": span.column, "offset": span.start},
            "end": {"line": span.end_line, "column": span.end_column, "offset": span.end}}


def _diagnostic(d: Diagnostic, stage: str) -> dict:
    return {"code": d.code, "message": d.message, "stage": stage, **_span(d.span)}


def _graph(module: ir.Module, types: TypeInfo) -> list[dict]:
    pipelines = []
    for pipe in module.pipelines:
        nodes = [{"id": node.name, "kind": node.kind, "label": ir.body_text(node),
                  "schema": ir.schema_text(types.schemas[pipe.name, node.name]) if node.kind != "USE" else None,
                  "origin": list(node.origin), **_span(node.span)} for node in pipe.nodes]
        edges = [{"from": ref.node, "from_port": ref.port, "to": node.name, "to_port": port}
                 for node in pipe.nodes for port, ref in node.inputs]
        pipelines.append({"name": pipe.name, "root": pipe.name in module.defaults, "nodes": nodes, "edges": edges})
    return pipelines


def _ir(module: ir.Module, types: TypeInfo) -> dict:
    return {"text": ir.format_module(module, types.schemas), "pipelines": _graph(module, types)}


def strip_comments(code: str) -> str:
    """Quita los comentarios del código generado para mostrarlo más limpio.

    Usa el tokenizador de Python, así que un `#` dentro de un string se conserva.
    Las líneas que solo tenían un comentario desaparecen.
    """
    comments = {token.start[0]: token.start[1]
                for token in tokenize.generate_tokens(io.StringIO(code).readline)
                if token.type == tokenize.COMMENT}
    kept = []
    for number, line in enumerate(code.split("\n"), start=1):
        column = comments.get(number)
        if column is None:
            kept.append(line)
        elif line[:column].strip():
            kept.append(line[:column].rstrip())
    return "\n".join(kept)


def resolve_passes(passes) -> tuple[str, ...]:
    """None: pases por defecto. Lanza ValueError si alguno no existe."""
    passes = DEFAULT if passes is None else tuple(passes)
    unknown = [name for name in passes if name not in PASSES]
    if unknown:
        raise ValueError(f"Pases desconocidos: {unknown}; disponibles: {list(PASSES)}.")
    return passes


def compile_source(source: str, passes=None, *, base_dir=".") -> dict:
    """Compila sin leer datos. `passes=None` aplica los pases por defecto; `()` equivale a -O0.

    Lanza ValueError solo si `passes` nombra un pase inexistente (error del cliente,
    no del programa).
    """
    passes = resolve_passes(passes)
    result = {"ok": False, "passes": list(passes), "diagnostics": [], "ast": None,
              "ir": {"before": None, "after": None}, "code": None}
    try:
        program = parse(source, filename=FILENAME)
    except ParseError as exc:
        stage = "lexical" if exc.diagnostic.code == "E_LEXICAL" else "syntax"
        result["diagnostics"] = [_diagnostic(exc.diagnostic, stage)]
        return result
    result["ast"] = to_dict(program)
    issues = validate(program)
    if issues:
        result["diagnostics"] = [_diagnostic(d, "structure") for d in issues]
        return result
    before = ir.lower(program)
    types = check(before)
    result["ir"]["before"] = _ir(before, types)
    if types.diagnostics:
        result["diagnostics"] = [_diagnostic(d, "types") for d in types.diagnostics]
        return result
    after = optimize(before, passes)
    result["ir"]["after"] = _ir(after, types)
    try:
        result["code"] = strip_comments(generate(after, filename=FILENAME, base_dir=base_dir))
    except CompileError as exc:
        result["diagnostics"] = [_diagnostic(d, "codegen") for d in exc.diagnostics]
        return result
    result["ok"] = True
    return result


def _json_value(value):
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    return str(value)


def _table(frame: pl.DataFrame, limit: int) -> dict:
    return {"columns": [{"name": name, "type": str(dtype)} for name, dtype in frame.schema.items()],
            "rows": [[_json_value(v) for v in row] for row in frame.head(limit).rows()],
            "total_rows": frame.height}


def _runtime_diagnostic(exc: Exception) -> dict:
    """Ubica un error de ejecución en el programa a partir de la etiqueta del paso.

    Solo se conoce la línea y columna de la declaración: no hay desplazamientos.
    """
    text = str(exc)
    match = _LABEL.match(text)
    code, message, line, column = "E_RUNTIME", text, 1, 1
    if match is not None:
        code = match["code"] or code
        message = f"{match['where']}: {match['message']}"
        line, column = int(match["line"]), int(match["column"])
    return {"code": code, "message": message, "stage": "runtime",
            "start": {"line": line, "column": column, "offset": None},
            "end": {"line": line, "column": column + 1, "offset": None}}


def run_source(source: str, passes=None, *, base_dir=".", root=None, limit=100) -> dict:
    """Compila y ejecuta los pipelines raíz.

    Las rutas relativas de SOURCE y SINK se resuelven desde `base_dir` y no
    pueden salir de `root`. Devuelve hasta `limit` filas de cada SINK y OUTPUT.
    """
    result = compile_source(source, passes, base_dir=base_dir)
    result["results"] = None
    if not result["ok"]:
        return result
    namespace = {"__name__": "etl_generated"}
    exec(compile(result["code"], FILENAME, "exec"), namespace)
    try:
        with PolarsRuntime(base_dir, root=root) as rt:
            outputs = run_pipelines(rt, namespace["PIPELINES"], namespace["DEFAULT_PIPELINES"])
            result["results"] = {
                pipeline: {name: _table(rt.collect(frame, name), limit) for name, frame in tables.items()}
                for pipeline, tables in outputs.items()}
    except (ExecutionError, pl.exceptions.PolarsError, OSError) as exc:
        result["ok"] = False
        result["diagnostics"] = [_runtime_diagnostic(exc)]
    return result
