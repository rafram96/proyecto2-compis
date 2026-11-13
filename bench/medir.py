"""Una medición: ejecuta una tarea con una variante y escribe una línea JSON en stdout.

    python bench/medir.py resumen_precios dsl --sf 1
    python bench/medir.py resumen_precios dsl --sf 1 --pases ""          # -O0
    python bench/medir.py resumen_precios polars --sf 1 --sin-opt-polars

run.py lo lanza en un proceso nuevo por repetición, así ninguna corrida hereda memoria
ni cachés de otra. `segundos` cubre leer, transformar y escribir; no incluye arrancar
Python ni importar bibliotecas. En la variante dsl, la compilación se mide aparte.
`memoria_mb` es el pico de memoria residente del proceso (Linux).
"""
import argparse
import importlib.util
import json
from pathlib import Path
from string import Template
import sys
import time

BENCH = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH.parent))  # etl_dsl desde el repositorio

from datos import carpeta  # noqa: E402

TAREAS = BENCH / "tareas"
VARIANTES = ("dsl", "polars", "pandas", "duckdb")


def opt_polars(activadas: bool):
    import polars as pl
    return pl.QueryOptFlags() if activadas else pl.QueryOptFlags.none()


def correr_dsl(tarea: Path, datos: Path, salida: Path, pases, optimizar_polars: bool) -> dict:
    from etl_dsl import compile_program, parse_file
    from etl_dsl.runtime import PolarsRuntime, run_pipelines

    flags = opt_polars(optimizar_polars)

    class Runtime(PolarsRuntime):
        # Igual que PolarsRuntime, pero permite apagar el optimizador de Polars.
        def collect(self, table, label="collect"):
            return self.frame(table, label).collect(optimizations=flags)

    programa = tarea / "programa.etl"
    inicio = time.perf_counter()
    codigo = compile_program(parse_file(programa), filename=str(programa), base_dir=datos, passes=pases)
    compilacion = time.perf_counter() - inicio
    namespace = {"__name__": "bench"}
    exec(compile(codigo, str(programa), "exec"), namespace)
    inicio = time.perf_counter()
    with Runtime(datos) as rt:
        run_pipelines(rt, namespace["PIPELINES"], namespace["DEFAULT_PIPELINES"])
    return {"segundos": time.perf_counter() - inicio, "compilacion_s": compilacion}


def correr_manual(tarea: Path, variante: str, datos: Path, salida: Path, optimizar_polars: bool) -> dict:
    archivo = tarea / f"{variante}_manual.py"
    spec = importlib.util.spec_from_file_location(f"{tarea.name}_{variante}", archivo)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    flags = opt_polars(optimizar_polars) if variante == "polars" else None
    inicio = time.perf_counter()
    modulo.ejecutar(datos, salida, flags)
    return {"segundos": time.perf_counter() - inicio}


def correr_duckdb(tarea: Path, datos: Path, salida: Path) -> dict:
    import duckdb

    sql = Template((tarea / "consulta.sql").read_text(encoding="utf-8"))
    script = sql.substitute(datos=datos.as_posix(), salida=salida.as_posix())
    inicio = time.perf_counter()
    with duckdb.connect() as con:
        con.execute(script)
    return {"segundos": time.perf_counter() - inicio}


def memoria_pico_mb() -> float | None:
    try:
        import resource
    except ImportError:  # Windows: sin getrusage
        return None
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024  # Linux informa KiB


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tarea", choices=sorted(p.name for p in TAREAS.iterdir() if p.is_dir()))
    parser.add_argument("variante", choices=VARIANTES)
    parser.add_argument("--sf", type=float, required=True)
    parser.add_argument("--pases", default=None,
                        help='pases del DSL separados por comas; "" equivale a -O0 (por defecto, todos)')
    parser.add_argument("--sin-opt-polars", action="store_true", help="apagar el optimizador de Polars")
    args = parser.parse_args(argv)

    datos = carpeta(args.sf)
    if not (datos / "manifest.json").exists():
        parser.error(f"no hay datos para sf={args.sf:g}; generarlos con bench/datos.py --sf {args.sf:g}")
    salida = datos / "salida" / args.variante
    salida.mkdir(parents=True, exist_ok=True)
    tarea = TAREAS / args.tarea

    if args.variante == "dsl":
        from etl_dsl.passes import DEFAULT
        pases = DEFAULT if args.pases is None else tuple(p for p in args.pases.split(",") if p)
        resultado = correr_dsl(tarea, datos, salida, pases, not args.sin_opt_polars)
    elif args.variante == "duckdb":
        resultado = correr_duckdb(tarea, datos, salida)
    else:
        resultado = correr_manual(tarea, args.variante, datos, salida, not args.sin_opt_polars)
    resultado["memoria_mb"] = memoria_pico_mb()
    print(json.dumps(resultado))
    return 0


if __name__ == "__main__":
    sys.exit(main())
