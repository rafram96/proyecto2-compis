"""Regenera src/data/compiled.json con la salida REAL del compilador.

Uso (desde la raíz del repo):  .venv/bin/python web/scripts/gen_compiled.py
Compila demo/optimizaciones.etl con las 8 combinaciones de pases y guarda IR y Python.
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = "demo/optimizaciones.etl"
PASES = ["constantes", "filtros", "muertos"]


def run(fmt: str, pases: list[str]) -> str:
    cmd = [sys.executable, "main.py", SRC, "--format", fmt]
    cmd += ["--pases", ",".join(pases)] if pases else ["-O0"]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    if r.returncode:
        sys.exit(r.stderr)
    if fmt == "ir":
        return r.stdout
    code = (ROOT / "output" / "optimizaciones.py").read_text()
    body = code[code.index("def pipeline_0"):code.index("PIPELINES =")].rstrip() + "\n"
    return re.sub(r"'demo/optimizaciones.etl:\d+:\d+ [^']*'", "'…'", body)  # sin rutas locales


out = {}
for mask in range(8):
    activos = [p for i, p in enumerate(PASES) if mask >> i & 1]
    key = "".join(str(mask >> i & 1) for i in range(3))
    out[key] = {"ir": run("ir", activos), "py": run("python", activos)}
out["source"] = (ROOT / SRC).read_text()
(ROOT / "web/src/data/compiled.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
print("OK web/src/data/compiled.json")
