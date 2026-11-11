"""Puente entre la web y etl_dsl.

Lo usan dos lugares, para que ambos produzcan exactamente lo mismo:
- `web/scripts/gen_compiled.py`, que precalcula la salida que la página muestra al cargar;
- el worker de Pyodide (`worker.ts`), que corre el compilador real en el navegador.

Presenta la API pública de análisis sin escribir archivos ni capturar stderr.
Conserva los formatos de consola y entrega además el contrato estructurado.
"""
import json
from pathlib import Path

from etl_dsl import analyze
from etl_dsl.analysis import FORMATS, artifacts_for_format, format_diagnostics, format_output


def _without_spans(node):
    if isinstance(node, dict):
        return {k: _without_spans(v) for k, v in node.items() if k != "span"}
    if isinstance(node, list):
        return [_without_spans(v) for v in node]
    return node


def _compact(fmt: str, out: str) -> str:
    """Vista para la web: tokens como tabla y AST sin posiciones. El resto queda igual que la CLI."""
    if fmt == "tokens":
        rows = [(f"{t['span']['line']}:{t['span']['column']}", t["kind"], t["lexeme"]) for t in json.loads(out)]
        w0 = max((len(r[0]) for r in rows), default=0)
        w1 = max((len(r[1]) for r in rows), default=0)
        return "".join(f"{a:<{w0}}  {b:<{w1}}  {c}\n" for a, b, c in rows)
    if fmt == "ast":
        return json.dumps(_without_spans(json.loads(out)), ensure_ascii=False, indent=2) + "\n"
    if fmt == "python":
        # La ruta absoluta del directorio de trabajo no aporta nada fuera de esta máquina.
        return out.replace(repr(str(Path(".").resolve())), "'.'")
    return out


def compile_etl(source: str, name: str = "programa.etl", fmt: str = "check", passes=None, compact=True) -> dict:
    """`name` es lógico, no una ruta que se lea o escriba en el navegador/host."""
    result = analyze(source, filename=name, base_dir=".", passes=passes,
                     artifacts=artifacts_for_format(fmt))
    out = format_output(result, fmt) if result.ok else ""
    payload = result.to_dict()
    if result.ok and compact:
        out = _compact(fmt, out)
    python = payload["artifacts"]["python"]
    if compact and python["status"] == "available":
        python["data"] = _compact("python", python["data"])
    return {"ok": result.ok, "out": out, "err": format_diagnostics(result, source),
            "analysis": payload}
