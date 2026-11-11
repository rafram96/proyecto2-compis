"""Entrada ligera: fija los hilos ANTES de importar Polars o el arnés."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Evaluación C5 reproducible en memoria")
    parser.add_argument("--mode", choices=("small", "measure"), default="small")
    parser.add_argument("--sizes", help="Filas izquierdas, separadas por coma")
    parser.add_argument("--seed", type=int, default=20261111)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--warmups", type=int)
    parser.add_argument("--scenarios", default="normal,final_flags_none",
                        help="normal y/o final_flags_none, separados por coma")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        sizes = tuple(int(n) for n in (args.sizes or
                      ("64" if args.mode == "small" else "10000,200000")).split(","))
    except ValueError:
        parser.error("--sizes requiere enteros separados por coma")
    repetitions = args.repetitions if args.repetitions is not None else (2 if args.mode == "small" else 10)
    warmups = args.warmups if args.warmups is not None else (1 if args.mode == "small" else 2)
    scenarios = tuple(args.scenarios.split(","))
    if (args.threads < 1 or repetitions < 1 or warmups < 0 or not sizes or min(sizes) < 0
            or len(set(sizes)) != len(sizes) or len(set(scenarios)) != len(scenarios)
            or not set(scenarios) <= {"normal", "final_flags_none"}):
        parser.error("Tamaños/opciones inválidos")
    os.environ["POLARS_MAX_THREADS"] = str(args.threads)
    from .harness import run
    output = args.output or Path("benchmarks/results") / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    try:
        run(output, sizes=sizes, seed=args.seed, repetitions=repetitions,
            warmups=warmups, scenarios=scenarios, threads=args.threads, mode=args.mode)
    except (AssertionError, ValueError, OSError) as exc:
        parser.exit(1, f"Evaluación invalidada: {exc}\n")
    print(f"Evaluación válida: {output / 'report.md'}")


if __name__ == "__main__":
    main()
