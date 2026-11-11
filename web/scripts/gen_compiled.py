"""Regenera src/data/compiled.json con la salida REAL del compilador.

Uso (desde la raíz del repo):  .venv/bin/python web/scripts/gen_compiled.py

Todo pasa por web/src/compiler/studio.py, el mismo puente que usa el worker de Pyodide,
así que lo que la página muestra al cargar es idéntico a lo que el navegador compila después.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
sys.path[:0] = [str(ROOT), str(WEB / "src" / "compiler")]

from etl_dsl.passes import PASSES  # noqa: E402
from studio import FORMATS, compile_etl  # noqa: E402

PASES = ["constantes", "filtros", "muertos"]
# Ejemplos del estudio: nombre del archivo -> origen en el repo.
PROGRAMS = {
    "ventas.etl": WEB / "scripts/programs/ventas.etl",
    "credit_risk.etl": ROOT / "input/credit_risk.etl",
    "pendientes.etl": WEB / "scripts/programs/pendientes.etl",
    "pendientes_ok.etl": None,  # pendientes.etl con la corrección que sugiere el diagnóstico
}


def outputs(name: str, source: str, passes=None) -> dict:
    return {fmt: compile_etl(source, name, fmt, passes) for fmt in FORMATS}


def count_tests() -> int:
    r = subprocess.run([sys.executable, "-m", "unittest", "discover"], cwd=ROOT, capture_output=True, text=True)
    m = re.search(r"Ran (\d+) tests?", r.stderr)
    if r.returncode or not m:
        sys.exit("Las pruebas fallan; no se generan datos.\n" + r.stderr[-2000:])
    return int(m.group(1))


def main() -> None:
    out: dict = {"optimizer": {}, "programs": {}}
    sources = {name: path.read_text(encoding="utf-8") for name, path in PROGRAMS.items() if path}
    sources["pendientes_ok.etl"] = sources["pendientes.etl"].replace("== NULL", "IS NULL")

    cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            opt_src = (ROOT / "demo/optimizaciones.etl").read_text(encoding="utf-8")
            out["optimizer"]["source"] = opt_src
            for mask in range(8):
                activos = [p for i, p in enumerate(PASES) if mask >> i & 1]
                key = "".join(str(mask >> i & 1) for i in range(3))
                ir = compile_etl(opt_src, "optimizaciones.etl", "ir", activos)
                py = compile_etl(opt_src, "optimizaciones.etl", "python", activos)
                assert ir["ok"] and py["ok"], (key, ir["err"], py["err"])
                out["optimizer"][key] = {"ir": ir["out"], "py": py["out"]}
            for key, source in sources.items():
                name = key.replace("_ok", "")  # la versión corregida se compila con el nombre original
                out["programs"][key] = {"source": source, "default": outputs(name, source),
                                        "O0": {fmt: compile_etl(source, name, fmt, []) for fmt in ("ir", "python")}}
        finally:
            os.chdir(cwd)

    grammar = (ROOT / "etl_dsl/grammar.lark").read_text(encoding="utf-8")
    codes = set(re.findall(r"\bE_[A-Z_]+\b", "".join(p.read_text() for p in (ROOT / "etl_dsl").glob("*.py"))))
    out["stats"] = {
        "tests": count_tests(),
        "errorCodes": len(codes),
        "keywords": len(set(re.findall(r'"([A-Z_]{2,})"i?', grammar))),
        "passes": list(PASSES),
    }
    dest = WEB / "src/data/compiled.json"
    dest.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"OK {dest.relative_to(ROOT)} · {out['stats']}")


if __name__ == "__main__":
    main()
