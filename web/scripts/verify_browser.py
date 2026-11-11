"""Prueba C1 con playwright-cli contra Vite ya iniciado (sin instalar SDKs).

Desde la raíz: python web/scripts/verify_browser.py --url http://127.0.0.1:5173/
Los artefactos del navegador quedan en web/.playwright-cli/ (ignorado por Git).
"""
import argparse
from pathlib import Path
import shutil
import subprocess
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5173/")
    args = parser.parse_args()
    cli = shutil.which("playwright-cli")
    if cli is None:
        parser.error("Se necesita playwright-cli en PATH.")
    web = Path(__file__).resolve().parents[1]
    session = f"cauce-c1-{uuid4().hex[:8]}"
    command = [cli, f"-s={session}"]
    code = (web / "tests/browser/analysis.js").read_text(encoding="utf-8")
    try:
        subprocess.run([*command, "open", args.url], cwd=web, check=True, timeout=45)
        completed = subprocess.run([*command, "run-code", code], cwd=web, check=True,
                                   capture_output=True, text=True, timeout=90)
        print(completed.stdout, end="")
        print(completed.stderr, end="")
        # playwright-cli puede informar errores del snippet con código de salida 0.
        if "### Error" in completed.stdout or '"compared":32' not in completed.stdout:
            raise SystemExit("Falló la verificación de C1; revisar la salida de playwright-cli.")
    finally:
        subprocess.run([*command, "close"], cwd=web, timeout=15)


if __name__ == "__main__":
    main()
