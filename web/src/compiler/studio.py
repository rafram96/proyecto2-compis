"""Puente entre la web y etl_dsl.

Lo usan dos lugares, para que ambos produzcan exactamente lo mismo:
- `web/scripts/gen_compiled.py`, que precalcula la salida que la página muestra al cargar;
- el worker de Pyodide (`worker.ts`), que corre el compilador real en el navegador.

Reproduce `python -m etl_dsl <archivo> --format <fmt> [--pases ...|-O0] --base-dir .`
sin escribir en `output/`: devuelve stdout, stderr y si terminó bien.
"""
import contextlib
import io
import json
from pathlib import Path

from etl_dsl.diagnostics import ParseError
from etl_dsl.main import _analyze
from etl_dsl.passes import DEFAULT, PASSES

FORMATS = ("check", "tokens", "tree", "ast", "ir", "python")


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
    """Compila `source` como si fuera el archivo `name` del directorio actual."""
    if fmt not in FORMATS:
        raise ValueError(f"formato desconocido: {fmt}")
    passes = DEFAULT if passes is None else tuple(passes)
    unknown = [p for p in passes if p not in PASSES]
    if unknown:
        raise ValueError(f"pases desconocidos: {', '.join(unknown)}")
    path = Path(name)
    path.write_text(source, encoding="utf-8")
    err = io.StringIO()
    out = ""
    ok = True
    with contextlib.redirect_stderr(err):
        try:
            out = _analyze(path, fmt, Path("."), passes)
        except (OSError, UnicodeError, ParseError, ValueError) as exc:
            print(exc, file=err)
            ok = False
    if ok and compact:
        out = _compact(fmt, out)
    return {"ok": ok, "out": out, "err": err.getvalue()}
