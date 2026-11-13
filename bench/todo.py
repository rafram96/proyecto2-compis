"""Experimento completo en un comando: datos, verificación, mediciones y un zip con todo.

    python bench/todo.py                                  # SF 1, 5 y 10, 10 repeticiones
    python bench/todo.py --sf 1 5 10 20 --borrar-datos
    docker compose run --rm bench                         # lo mismo, dentro de Docker

Pasos:
1. Genera los datos TPC-H que falten (bench/datos.py), incluida SF 0.1 para verificar.
2. Verifica que todas las variantes dan el mismo resultado (bench/verificar.py). Si
   alguna difiere, se detiene: las mediciones no serían comparables.
3. Mide (bench/run.py) y guarda la salida en log.txt.
4. Empaqueta bench/resultados/<corrida>/ en bench/resultados/<corrida>.zip.

Los argumentos que no reconoce se pasan a run.py (por ejemplo --grupo rendimiento o
--repeticiones 3).
"""
import argparse
from datetime import datetime
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

BENCH = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH))
from datos import ESCALAS, RAIZ  # noqa: E402

SF_VERIFICACION = 0.1


def ejecutar(comando: list[str], log: Path | None = None) -> int:
    """Ejecuta mostrando la salida en vivo y, si se indica, copiándola a `log`."""
    print("$ " + " ".join(comando), flush=True)
    with subprocess.Popen(comando, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding="utf-8", errors="replace") as proceso:
        archivo = open(log, "a", encoding="utf-8") if log else None
        try:
            for linea in proceso.stdout:
                print(linea, end="", flush=True)
                if archivo:
                    archivo.write(linea)
                    archivo.flush()
        finally:
            if archivo:
                archivo.close()
    return proceso.returncode


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sf", type=float, nargs="+", default=list(ESCALAS))
    parser.add_argument("--nombre", default=None,
                        help="nombre de la corrida (por defecto, fecha, hora y equipo)")
    parser.add_argument("--borrar-datos", action="store_true",
                        help="borrar bench/datos/ al terminar (ocupa unos 20 GB con SF 1, 5 y 10)")
    args, extra = parser.parse_known_args(argv)
    equipo = re.sub(r"[^A-Za-z0-9_-]", "-", platform.node()) or "equipo"
    nombre = args.nombre or f"{datetime.now():%Y-%m-%d_%H-%M}_{equipo}"
    destino = BENCH / "resultados" / nombre
    if destino.exists():
        parser.error(f"ya existe {destino}; usar otro --nombre")
    destino.mkdir(parents=True)
    python = sys.executable

    escalas = sorted({SF_VERIFICACION, *args.sf})
    if ejecutar([python, str(BENCH / "datos.py"), "--sf", *(f"{sf:g}" for sf in escalas)]) != 0:
        print("Falló la generación de datos.")
        return 1
    if ejecutar([python, str(BENCH / "verificar.py"), "--sf", f"{SF_VERIFICACION:g}"],
                destino / "verificacion.txt") != 0:
        print(f"Las variantes no coinciden; ver {destino / 'verificacion.txt'}. No se mide.")
        return 1
    codigo = ejecutar([python, str(BENCH / "run.py"), "--sf", *(f"{sf:g}" for sf in args.sf),
                       "--nombre", nombre, *extra], destino / "log.txt")
    if codigo != 0:
        print(f"run.py terminó con código {codigo}; se empaqueta lo medido hasta ahí.")

    zip_ruta = destino.with_suffix(".zip")
    with zipfile.ZipFile(zip_ruta, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for ruta in sorted(destino.rglob("*")):
            zf.write(ruta, Path(nombre) / ruta.relative_to(destino))
    print(f"\nResultados: {destino}\nZip para guardar: {zip_ruta}")

    if args.borrar_datos:
        shutil.rmtree(RAIZ, ignore_errors=True)
        print(f"Datos borrados: {RAIZ}")
    return codigo


if __name__ == "__main__":
    sys.exit(main())
