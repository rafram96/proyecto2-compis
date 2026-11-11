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
    parser.add_argument("--content-only", action="store_true", help="Recorrido de contenido, también en vite preview")
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    args = parser.parse_args()
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
                  ("content.js", ('"content":true', '"storageFailure":true'))]
        if args.content_only:
            suites = suites[-1:]
        for script, required in suites:
            code = (web / "tests/browser" / script).read_text(encoding="utf-8").strip().removesuffix(";")
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
        if args.content_only:
            return
        sys.path[:0] = [str(web.parent), str(web / "src/compiler")]
        from studio import compile_etl
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
