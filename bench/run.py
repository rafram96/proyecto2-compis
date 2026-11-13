"""Benchmarks: rendimiento del DSL frente a Polars, Pandas y DuckDB, e impacto de cada pase.

    python bench/run.py                                   # todo: SF 1, 5 y 10, 10 repeticiones
    python bench/run.py --grupo rendimiento --sf 1 --repeticiones 3
    docker compose run --rm bench python bench/run.py

Cada medición es un proceso nuevo de bench/medir.py. Por cada escala y tarea, primero
corre una vez cada configuración sin registrarla (calentamiento: la caché de archivos del
sistema queda igual para todas) y luego las repeticiones, con las configuraciones en orden
aleatorio en cada ronda para que ninguna quede siempre primera o última. Si una
configuración se queda sin memoria, se pasa del tiempo límite o falla, se registra una vez
y no se vuelve a intentar en esa escala y tarea.

Resultados en bench/resultados/<corrida>/: tiempos.csv (una fila por medición) y
entorno.json (CPU, memoria, versiones y parámetros). Verificar antes con bench/verificar.py.
"""
import argparse
import csv
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import sys
import time

BENCH = Path(__file__).resolve().parent
sys.path.insert(0, str(BENCH))
from datos import ESCALAS, carpeta  # noqa: E402

TAREAS = sorted(p.name for p in (BENCH / "tareas").iterdir() if p.is_dir())

# Configuración -> argumentos de medir.py.
CONFIGURACIONES = {
    "dsl": ["dsl"],
    "polars": ["polars"],
    "pandas": ["pandas"],
    "duckdb": ["duckdb"],
    "dsl-O0": ["dsl", "--pases", ""],
    "dsl-constantes": ["dsl", "--pases", "constantes"],
    "dsl-filtros": ["dsl", "--pases", "filtros"],
    "dsl-codigo_muerto": ["dsl", "--pases", "codigo_muerto"],
    # Sin el optimizador de Polars, para aislar lo que aportan los pases del DSL.
    "dsl-sin-opt-polars": ["dsl", "--sin-opt-polars"],
    "dsl-O0-sin-opt-polars": ["dsl", "--pases", "", "--sin-opt-polars"],
    "polars-sin-opt-polars": ["polars", "--sin-opt-polars"],
}
GRUPOS = {
    "rendimiento": ["dsl", "polars", "pandas", "duckdb"],
    "optimizaciones": ["dsl-O0", "dsl-constantes", "dsl-filtros", "dsl-codigo_muerto", "dsl",
                       "dsl-O0-sin-opt-polars", "dsl-sin-opt-polars", "polars-sin-opt-polars"],
}
GRUPOS["todo"] = list(CONFIGURACIONES)

COLUMNAS = ["sf", "tarea", "configuracion", "repeticion", "estado",
            "segundos", "compilacion_s", "memoria_mb", "detalle"]


def medir(tarea: str, configuracion: str, sf: float, limite: float) -> dict:
    comando = [sys.executable, str(BENCH / "medir.py"), tarea, *CONFIGURACIONES[configuracion], "--sf", f"{sf:g}"]
    try:
        proceso = subprocess.run(comando, capture_output=True, text=True, timeout=limite)
    except subprocess.TimeoutExpired:
        return {"estado": "tiempo_agotado", "detalle": f"más de {limite:g} s"}
    if proceso.returncode == 0:
        return {"estado": "ok", **json.loads(proceso.stdout.strip().splitlines()[-1])}
    error = proceso.stderr.strip().splitlines()[-1:] or [""]
    sin_memoria = proceso.returncode == -9 or any(
        texto in proceso.stderr for texto in ("MemoryError", "memory allocation", "out of memory"))
    return {"estado": "sin_memoria" if sin_memoria else "error",
            "detalle": f"código {proceso.returncode}: {error[0][:300]}"}


def leer(ruta: str) -> str | None:
    try:
        return Path(ruta).read_text(encoding="utf-8")
    except OSError:
        return None


def entorno(args) -> dict:
    from importlib.metadata import PackageNotFoundError, version

    def ver(paquete):
        try:
            return version(paquete)
        except PackageNotFoundError:
            return None

    cpuinfo = leer("/proc/cpuinfo") or ""
    modelo = next((l.split(":", 1)[1].strip() for l in cpuinfo.splitlines() if l.startswith("model name")), None)
    meminfo = leer("/proc/meminfo") or ""
    total_kb = next((int(l.split()[1]) for l in meminfo.splitlines() if l.startswith("MemTotal")), None)
    limite = (leer("/sys/fs/cgroup/memory.max") or "").strip()
    return {
        "fecha": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "plataforma": platform.platform(),
        "cpu": modelo or platform.processor(),
        "hilos": os.cpu_count(),
        "memoria_total_gb": round(total_kb / 1024 ** 2, 2) if total_kb else None,
        "limite_cgroup": limite or None,
        "python": platform.python_version(),
        "versiones": {p: ver(p) for p in ("polars", "duckdb", "pandas", "pyarrow", "numpy", "lark")},
        "parametros": {"sf": args.sf, "tareas": args.tareas, "configuraciones": args.configuraciones,
                       "repeticiones": args.repeticiones, "limite_s": args.limite, "semilla": args.semilla},
        "datos": {f"{sf:g}": json.loads((carpeta(sf) / "manifest.json").read_text()) for sf in args.sf},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sf", type=float, nargs="+", default=list(ESCALAS))
    parser.add_argument("--tareas", nargs="+", choices=TAREAS, default=TAREAS)
    parser.add_argument("--grupo", choices=GRUPOS, default="todo")
    parser.add_argument("--configuraciones", nargs="+", choices=CONFIGURACIONES,
                        help="en lugar de --grupo")
    parser.add_argument("--repeticiones", type=int, default=10)
    parser.add_argument("--limite", type=float, default=900, help="segundos máximos por medición")
    parser.add_argument("--semilla", type=int, default=2026, help="orden aleatorio de las configuraciones")
    parser.add_argument("--nombre", default=None, help="carpeta de la corrida (por defecto, fecha y hora)")
    args = parser.parse_args(argv)
    args.configuraciones = args.configuraciones or GRUPOS[args.grupo]
    if args.repeticiones < 1:
        parser.error("--repeticiones debe ser al menos 1")
    faltan = [f"{sf:g}" for sf in args.sf if not (carpeta(sf) / "manifest.json").exists()]
    if faltan:
        parser.error(f"faltan datos para sf={', '.join(faltan)}; generarlos con bench/datos.py")

    nombre = args.nombre or datetime.now().strftime("%Y-%m-%d_%H-%M")
    destino = BENCH / "resultados" / nombre
    destino.mkdir(parents=True, exist_ok=True)
    (destino / "entorno.json").write_text(json.dumps(entorno(args), indent=2, ensure_ascii=False), encoding="utf-8")
    azar = random.Random(args.semilla)
    total = len(args.sf) * len(args.tareas) * len(args.configuraciones) * (args.repeticiones + 1)
    hechas, inicio = 0, time.monotonic()

    with open(destino / "tiempos.csv", "w", newline="", encoding="utf-8") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS)
        escritor.writeheader()

        def registrar(sf, tarea, configuracion, repeticion, resultado):
            nonlocal hechas
            fila = {"sf": f"{sf:g}", "tarea": tarea, "configuracion": configuracion,
                    "repeticion": repeticion, **resultado}
            escritor.writerow({k: fila.get(k) for k in COLUMNAS})
            archivo.flush()
            transcurrido = time.monotonic() - inicio
            resto = transcurrido / hechas * (total - hechas) if hechas else 0
            valor = f"{resultado['segundos']:.3f} s" if resultado["estado"] == "ok" else resultado["estado"]
            print(f"[{hechas}/{total} · faltan ~{resto / 60:.0f} min] sf={sf:g} {tarea} "
                  f"{configuracion} #{repeticion}: {valor}", flush=True)

        for sf in args.sf:
            for tarea in args.tareas:
                activas = []
                for configuracion in args.configuraciones:  # calentamiento, no se registra si sale bien
                    resultado = medir(tarea, configuracion, sf, args.limite)
                    hechas += 1
                    if resultado["estado"] == "ok":
                        activas.append(configuracion)
                    else:
                        hechas += args.repeticiones
                        registrar(sf, tarea, configuracion, 0, resultado)
                for repeticion in range(1, args.repeticiones + 1):
                    azar.shuffle(activas)
                    for configuracion in list(activas):
                        resultado = medir(tarea, configuracion, sf, args.limite)
                        hechas += 1
                        if resultado["estado"] != "ok":
                            activas.remove(configuracion)
                            hechas += args.repeticiones - repeticion
                        registrar(sf, tarea, configuracion, repeticion, resultado)
    print(f"Resultados en {destino}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
