"""Datos TPC-H para los benchmarks, generados con la extensión tpch de DuckDB.

Uso (desde la raíz del repositorio):
    python bench/datos.py                          # SF 1, 5 y 10 en Parquet y CSV
    python bench/datos.py --sf 0.1 --formatos parquet
    docker compose run --rm bench python bench/datos.py

Cada escala queda en bench/datos/sf<N>/ con un archivo por tabla y formato, más
manifest.json (filas, tamaños, versión de DuckDB y tiempo de generación). dbgen es
determinista: la misma escala produce siempre los mismos datos. Las escalas ya
generadas se omiten, salvo con --forzar.

Los DECIMAL de TPC-H se exportan como DOUBLE para que Pandas, Polars y DuckDB lean
el mismo tipo nativo. Además de las tablas de TPC-H se genera orders_sucio: pedidos
con nulos y duplicados exactos en posiciones fijas, para la tarea de limpieza.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys
import time

import duckdb

RAIZ = Path(__file__).resolve().parent / "datos"
TABLAS = ("lineitem", "orders", "customer", "nation")
ESCALAS = (1.0, 5.0, 10.0)
FORMATOS = ("parquet", "csv")
# Desde esta escala dbgen genera por partes para no superar la memoria del contenedor.
PARTES_DESDE = 5

# Nulos y duplicados en posiciones fijas (por clave), así el resultado es reproducible.
ORDERS_SUCIO = """
WITH base AS (
    SELECT o_orderkey, o_custkey, o_orderstatus,
           CASE WHEN o_orderkey % 13 = 0 THEN NULL ELSE CAST(o_totalprice AS DOUBLE) END AS o_totalprice,
           o_orderdate,
           CASE WHEN o_orderkey % 29 = 0 THEN NULL ELSE o_orderpriority END AS o_orderpriority,
           o_clerk, o_shippriority
    FROM orders
)
SELECT * FROM base
UNION ALL
SELECT * FROM base WHERE o_orderkey % 50 = 0
ORDER BY o_orderkey
"""


def carpeta(sf: float) -> Path:
    return RAIZ / ("sf" + f"{sf:g}".replace(".", "_"))


def consulta(con, tabla: str) -> str:
    """SELECT de la tabla con los DECIMAL convertidos a DOUBLE y los nombres originales."""
    columnas = []
    for nombre, tipo, *_ in con.execute(f"DESCRIBE {tabla}").fetchall():
        columnas.append(f"CAST({nombre} AS DOUBLE) AS {nombre}" if tipo.startswith("DECIMAL") else nombre)
    return f"SELECT {', '.join(columnas)} FROM {tabla}"


def generar(sf: float, formatos, memoria: str) -> dict:
    destino = carpeta(sf)
    parcial = destino.with_name(destino.name + ".parcial")
    shutil.rmtree(parcial, ignore_errors=True)
    parcial.mkdir(parents=True)
    inicio = time.perf_counter()
    base = parcial / "tpch.duckdb"
    with duckdb.connect(str(base)) as con:
        con.execute(f"SET memory_limit = '{memoria}'")
        con.execute(f"SET temp_directory = '{(parcial / 'tmp').as_posix()}'")
        con.execute("INSTALL tpch")
        con.execute("LOAD tpch")
        if sf >= PARTES_DESDE:
            partes = int(sf)
            for paso in range(partes):
                print(f"  dbgen sf={sf:g}: parte {paso + 1}/{partes}", flush=True)
                con.execute(f"CALL dbgen(sf={sf:g}, children={partes}, step={paso})")
        else:
            con.execute(f"CALL dbgen(sf={sf:g})")
        generado = time.perf_counter() - inicio

        archivos = {}
        filas = {}
        consultas = {tabla: consulta(con, tabla) for tabla in TABLAS}
        consultas["orders_sucio"] = ORDERS_SUCIO
        for tabla, sql in consultas.items():
            filas[tabla] = con.execute(f"SELECT count(*) FROM ({sql})").fetchone()[0]
            for formato in formatos:
                ruta = parcial / f"{tabla}.{formato}"
                opciones = "FORMAT parquet, COMPRESSION zstd" if formato == "parquet" else "FORMAT csv, HEADER true"
                print(f"  {ruta.name}: {filas[tabla]:,} filas", flush=True)
                con.execute(f"COPY ({sql}) TO '{ruta.as_posix()}' ({opciones})")
                archivos[ruta.name] = ruta.stat().st_size
    base.unlink()
    shutil.rmtree(parcial / "tmp", ignore_errors=True)

    manifest = {
        "sf": sf,
        "tablas": filas,
        "bytes": archivos,
        "duckdb": duckdb.__version__,
        "segundos_dbgen": round(generado, 2),
        "segundos_total": round(time.perf_counter() - inicio, 2),
        "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (parcial / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    # Renombrar al final: una carpeta sf<N>/ siempre está completa.
    shutil.rmtree(destino, ignore_errors=True)
    parcial.rename(destino)
    return manifest


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sf", type=float, nargs="+", default=ESCALAS, help="escalas de TPC-H")
    parser.add_argument("--formatos", nargs="+", choices=FORMATOS, default=FORMATOS)
    parser.add_argument("--memoria", default="4GB", help="memory_limit de DuckDB durante la generación")
    parser.add_argument("--forzar", action="store_true", help="regenerar escalas ya existentes")
    args = parser.parse_args(argv)
    if any(sf <= 0 for sf in args.sf):
        parser.error("--sf debe ser positivo")
    if any(sf >= PARTES_DESDE and sf != int(sf) for sf in args.sf):
        parser.error(f"las escalas desde {PARTES_DESDE} deben ser enteras (se generan por partes)")

    for sf in args.sf:
        destino = carpeta(sf)
        if (destino / "manifest.json").exists() and not args.forzar:
            print(f"sf={sf:g}: ya existe en {destino}, se omite (--forzar para regenerar)")
            continue
        print(f"sf={sf:g}: generando en {destino}", flush=True)
        manifest = generar(sf, args.formatos, args.memoria)
        print(f"sf={sf:g}: listo en {manifest['segundos_total']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
