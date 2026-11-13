"""Comprueba que todas las variantes de cada tarea producen el mismo resultado.

    python bench/verificar.py            # SF 0.1
    python bench/verificar.py --sf 1

Ejecuta cada variante una vez (con bench/medir.py) y compara sus archivos de salida con
los del DSL sin optimizar (-O0), que es la referencia. Las filas se comparan sin importar
su orden y los números con tolerancia relativa, porque sumar DOUBLE en otro orden cambia
los últimos decimales. Sin esta verificación las mediciones de run.py no son comparables.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys

import polars as pl
from polars.testing import assert_frame_equal

BENCH = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH))
from datos import carpeta  # noqa: E402

TAREAS = sorted(p.name for p in (BENCH / "tareas").iterdir() if p.is_dir())
# (nombre, argumentos de medir.py): la referencia va primero.
VARIANTES = [("dsl -O0", ["dsl", "--pases", ""]), ("dsl", ["dsl"]),
             ("polars", ["polars"]), ("pandas", ["pandas"]), ("duckdb", ["duckdb"])]


def leer(carpeta_salida: Path) -> dict[str, pl.DataFrame]:
    return {ruta.name: pl.read_parquet(ruta) for ruta in sorted(carpeta_salida.glob("*.parquet"))}


def normalizar(df: pl.DataFrame) -> pl.DataFrame:
    # Conteos: UInt32 en Polars, Int64 en el DSL, int64 en Pandas. Se compara el valor.
    df = df.with_columns(pl.col(pl.Int32, pl.UInt32, pl.UInt64).cast(pl.Int64))
    return df.sort(df.columns)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sf", type=float, default=0.1)
    args = parser.parse_args(argv)
    raiz = carpeta(args.sf) / "salida"
    fallas = 0
    for tarea in TAREAS:
        referencia = None
        for nombre, argumentos in VARIANTES:
            variante = argumentos[0]
            shutil.rmtree(raiz / variante, ignore_errors=True)
            proceso = subprocess.run([sys.executable, str(BENCH / "medir.py"), tarea, *argumentos,
                                      "--sf", f"{args.sf:g}"], capture_output=True, text=True)
            if proceso.returncode != 0:
                print(f"FALLA {tarea} / {nombre}: no terminó\n{proceso.stderr.strip()}")
                fallas += 1
                continue
            salidas = {k: normalizar(v) for k, v in leer(raiz / variante).items()}
            if referencia is None:
                referencia = salidas
                print(f"ok    {tarea} / {nombre}: referencia ({', '.join(f'{k}: {len(v)} filas' for k, v in salidas.items())})")
                continue
            try:
                assert salidas.keys() == referencia.keys(), f"archivos {sorted(salidas)} != {sorted(referencia)}"
                for archivo, esperado in referencia.items():
                    assert_frame_equal(salidas[archivo], esperado, check_dtypes=False,
                                       check_exact=False, rel_tol=1e-9)
                print(f"ok    {tarea} / {nombre}")
            except AssertionError as error:
                print(f"FALLA {tarea} / {nombre}: {error}")
                fallas += 1
    print("Todas las variantes coinciden." if not fallas else f"{fallas} diferencias.")
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
