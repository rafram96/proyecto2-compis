"""Prueba C1–C4 y el estudio W1/W4 con playwright-cli contra Vite iniciado.

Desde la raíz: python web/scripts/verify_browser.py --url http://127.0.0.1:5173/
Los artefactos del navegador quedan en web/.playwright-cli/ (ignorado por Git).
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execution-only", action="store_true", help="Recorrido HTTP/runner/archivos; funciona en producción sin /src/")
    parser.add_argument("--timeout-api", default="", help="API de prueba con CAUCE_TIMEOUT=0.02, necesaria para --execution-only")
    parser.add_argument("--inspectors-only", action="store_true", help="Inspectores reales, también en vite preview; no importa /src/")
    parser.add_argument("--content-only", action="store_true", help="Recorrido de contenido, también en vite preview")
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    args = parser.parse_args()
    if args.execution_only and not args.timeout_api:
        parser.error("--execution-only requiere --timeout-api con un runner real de plazo reducido.")
    cli = shutil.which("playwright-cli")
    if cli is None:
        parser.error("Se necesita playwright-cli en PATH.")
    web = Path(__file__).resolve().parents[1]
    session = f"cauce-web-{uuid4().hex[:8]}"
    command = [cli, f"-s={session}"]
    try:
        subprocess.run([*command, "open", args.url], cwd=web, check=True, timeout=45)
        suites = [("analysis.js", ('"compared":32', '"eliminated":true')),
                  ("workspace.js", ('"workspace":true', '"loadFailureRecovery":true')),
                  ("content.js", ('"content":true', '"storageFailure":true')),
                  ("inspectors.js", ('"inspectors":true', '"noRecompileOnExplore":true'))]
        if args.execution_only:
            suites = [("execution.js", ('"execution":true', '"timeout":true', '"download":true'))]
        if args.content_only:
            suites = suites[2:3]
        if args.inspectors_only:
            suites = suites[-1:]
        for script, required in suites:
            code = (web / "tests/browser" / script).read_text(encoding="utf-8").strip().removesuffix(";")
            code = code.replace("__CAUCE_TIMEOUT_API__", args.timeout_api)
            completed = subprocess.run([*command, "run-code", code], cwd=web, check=False,
                                       capture_output=True, text=True, timeout=150)
            (web / ".playwright-cli" / f"{script}.log").write_text(completed.stdout + completed.stderr, encoding="utf-8")
            print(completed.stdout.split("### Ran Playwright code")[0], end="", flush=True)
            print(completed.stderr, end="", flush=True)
            # playwright-cli puede informar errores del snippet con código de salida 0.
            if completed.returncode or "### Error" in completed.stdout or any(s not in completed.stdout for s in required):
                subprocess.run([*command, "screenshot", f"--filename=.playwright-cli/{script}-failure.png"], cwd=web, timeout=15)
                subprocess.run([*command, "snapshot"], cwd=web, timeout=15)
                raise SystemExit(f"Falló {script}; revisar la salida de playwright-cli.")
        sys.path[:0] = [str(web.parent), str(web / "src/compiler")]
        from studio import compile_etl
        if args.execution_only:
            import tempfile
            import polars as pl
            from etl_dsl import compile_program, parse
            from etl_dsl.runtime import PolarsRuntime
            from service.prepare import prepare
            with tempfile.TemporaryDirectory() as temp:
                prepare(temp)
                source = (web / "scripts/programs/ventas.etl").read_text()
                namespace = {"__name__": "verify_runtime"}
                exec(compile_program(parse(source)), namespace)
                with PolarsRuntime(temp) as runtime:
                    namespace["PIPELINES"]["ventas"](runtime)
                expected = pl.read_parquet(Path(temp) / "gasto_por_cliente.parquet")
                actual = pl.read_parquet(web / ".playwright-cli/d-ventas.parquet")
                if not expected.equals(actual) or expected.schema != actual.schema:
                    raise SystemExit("Ventas descargadas difieren del runtime Python.")
            if (web / ".playwright-cli/d-joins.csv").read_bytes() != (web.parent / "demo/joins_pedidos.csv").read_bytes():
                raise SystemExit("JOIN descargado difiere de la secuencia canónica.")
            print("Descargas reales: ventas (filas y esquema Parquet) y JOIN (CSV byte a byte) coinciden con Python.")
            return
        if not args.content_only:
            custom = (web / ".playwright-cli/custom-passes.py").read_text(encoding="utf-8")
            range_source = (web.parent / "demo/rangos.etl").read_text(encoding="utf-8")
            if custom != compile_etl(range_source, "rangos.etl", "python", ["rangos", "constantes"])["out"]:
                raise SystemExit("La descarga con pases personalizados difiere de CPython.")
            print("Descarga Python con pases personalizados verificada byte a byte.")
        if args.content_only or args.inspectors_only:
            return
        source = ('PIPELINE p { INPUT data: TABLE[x: INT?]; STEP f = FILTER { WHERE "😀" == "é" AND x\n'
                  ' IS NULL; } OUTPUT o: TABLE; FLOW { data -> f -> o; } }')
        exported = (web / ".playwright-cli/workspace-export.etl").read_bytes().decode("utf-8")
        generated = (web / ".playwright-cli/workspace-export.py").read_bytes().decode("utf-8")
        if exported != source or generated != compile_etl(source, "pendientes.etl", "python", [])['out']:
            raise SystemExit("Los bytes descargados no coinciden con el documento y el Python de CPython.")
        print("Descargas .etl/Python verificadas byte a byte.")
    finally:
        subprocess.run([*command, "close"], cwd=web, timeout=15)


if __name__ == "__main__":
    main()
