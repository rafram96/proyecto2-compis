"""Prueba C1–C4, el estudio W1 y las sugerencias W4 con playwright-cli contra Vite iniciado.

Desde la raíz: python web/scripts/verify_browser.py --url http://127.0.0.1:5173/
Los artefactos del navegador quedan en web/.playwright-cli/ (ignorado por Git).
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4


def verify_tutorial_downloads(web):
    """Las descargas del estudio deben ser byte a byte el CSV que escribe el runtime local."""
    import tempfile
    from etl_dsl import compile_program, parse
    from etl_dsl.runtime import PolarsRuntime
    demo = web.parent / "demo"
    with tempfile.TemporaryDirectory() as temp:
        (Path(temp) / "joins_pedidos.csv").write_bytes((demo / "joins_pedidos.csv").read_bytes())
        namespace = {"__name__": "verify_tutorial"}
        exec(compile_program(parse((demo / "tutorial.etl").read_text(encoding="utf-8"))), namespace)
        with PolarsRuntime(temp) as runtime:
            namespace["PIPELINES"]["gasto_por_cliente"](runtime)
        expected = (Path(temp) / "out/gasto_por_cliente.csv").read_bytes()
    for name in ("desktop-light", "mobile-dark"):
        if (web / f".playwright-cli/t-{name}.csv").read_bytes() != expected:
            raise SystemExit(f"La descarga del tutorial ({name}) difiere del runtime local.")
    print("Descargas del tutorial verificadas byte a byte contra el runtime local (2).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execution-only", action="store_true", help="Recorrido HTTP/runner/archivos; funciona en producción sin /src/")
    parser.add_argument("--timeout-api", default="", help="API de prueba con CAUCE_TIMEOUT=0.02, necesaria para --execution-only")
    parser.add_argument("--inspectors-only", action="store_true", help="Inspectores reales, también en vite preview; no importa /src/")
    parser.add_argument("--ux-only", action="store_true", help="Grafos, preview de fuente, tokens, diff y Blocks → CSV; requiere la API")
    parser.add_argument("--a11y-only", action="store_true", help="24 superficies con axe-core; instalar la herramienta opcional indicada en web/README.md")
    parser.add_argument("--content-only", action="store_true", help="Recorrido de contenido, también en vite preview")
    parser.add_argument("--evaluation-only", action="store_true", help="Recorrido /evaluacion y descargas C5; también en producción")
    parser.add_argument("--studio-only", action="store_true",
                        help="Divisor, disposición y enlaces /estudio?vista=…; también en producción (requiere la API)")
    parser.add_argument("--tutorial-only", action="store_true",
                        help="Tutorial CSV → resultado: artículo, enlaces, copia, error, ejecución y descarga (requiere la API)")
    parser.add_argument("--suggestions-only", action="store_true",
                        help="Sugerencias del editor y ¿quisiste decir? de E_COLUMN; también en producción, sin ejecutar trabajos")
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
                  ("inspectors.js", ('"inspectors":true', '"noRecompileOnExplore":true')),
                  ("evaluation.js", ('"evaluation":true', '"downloads":8', '"apiWhileReading":0')),
                  ("studio.js", ('"studio":true', '"noRecompileOnResize":true', '"viewLinks":9', '"linkJourneys":true')),
                  ("tutorial.js", ('"tutorial":true', '"journeys":2', '"execution":true', '"downloads":2')),
                  ("suggestions.js", ('"suggestions":true', '"journeys":2', '"zeroCompilesOnSuggest":true', '"quickFix":true'))]
        if args.execution_only:
            suites = [("execution.js", ('"execution":true', '"timeout":true', '"download":true'))]
        if args.content_only:
            suites = suites[2:3]
        if args.inspectors_only:
            suites = suites[3:4]
        if args.ux_only:
            suites = [("ux.js", ('"ux":true', '"blocks":true', '"execution":true', '"download":true'))]
        if args.a11y_only:
            suites = [("accessibility.js", ('"accessibility":true', '"surfaces":24', '"violations":0'))]
        if args.evaluation_only:
            suites = suites[4:5]
        if args.studio_only:
            suites = suites[5:6]
        if args.tutorial_only:
            suites = suites[6:7]
        if args.suggestions_only:
            suites = suites[7:8]
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
        if args.studio_only or args.suggestions_only or args.ux_only or args.a11y_only:
            return
        if args.tutorial_only or not (args.content_only or args.inspectors_only or args.execution_only
                                      or args.evaluation_only or args.suggestions_only):
            verify_tutorial_downloads(web)
            if args.tutorial_only:
                return
        if args.evaluation_only or not (args.content_only or args.inspectors_only or args.execution_only):
            import hashlib
            import json
            snapshot = web / "public/evidencia/c5-representativa"
            manifest_bytes = (snapshot / "manifest.json").read_bytes()
            manifest = json.loads(manifest_bytes)
            expected = {f["path"]: f["sha256"] for f in manifest["files"]}
            expected["manifest.json"] = hashlib.sha256(manifest_bytes).hexdigest()
            for name, digest in expected.items():
                saved = (web / f".playwright-cli/e-download-{name}").read_bytes()
                if hashlib.sha256(saved).hexdigest() != digest:
                    raise SystemExit(f"La descarga {name} no coincide con el hash publicado.")
            print(f"Descargas de evaluación verificadas: {len(expected)} archivos con el SHA-256 del manifiesto.")
            if args.evaluation_only:
                return
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
