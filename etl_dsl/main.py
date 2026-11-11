"""Entrada del compilador: procesa archivos individuales o una carpeta de entrada."""
import argparse
from pathlib import Path
import sys

from .analysis import analyze, artifacts_for_format, format_diagnostics, format_output
from .diagnostics import ParseError
from .passes import DEFAULT, PASSES


def _analyze(path: Path, fmt: str, base_dir=None, passes=DEFAULT) -> str:
    source = path.read_text(encoding="utf-8-sig")
    result = analyze(source, filename=str(path), base_dir=base_dir or path.resolve().parent,
                     passes=passes, artifacts=artifacts_for_format(fmt))
    if not result.ok:
        raise ValueError(format_diagnostics(result, source).rstrip("\n"))
    return format_output(result, fmt)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Compilador del DSL ETL para Polars")
    parser.add_argument("input", nargs="?", type=Path, default=Path("input"),
                        help="Archivo .etl o carpeta de programas (por defecto: input)")
    parser.add_argument("--output", "-o", type=Path,
                        help="Carpeta de salida (por defecto: output al procesar una carpeta)")
    parser.add_argument("--format", choices=("python", "check", "ast", "ir", "tree", "tokens"), default="python",
                        help="Salida del compilador (por defecto: python)")
    parser.add_argument("-O0", dest="no_opt", action="store_true", help="Desactivar los pases de optimización")
    parser.add_argument("--pases", help=f"Pases separados por comas, en orden (por defecto: {','.join(DEFAULT)}; "
                                        f"disponibles: {', '.join(PASSES)})")
    parser.add_argument("--run", action="store_true", help="Ejecutar con Polars después de generar Python")
    parser.add_argument("--pipeline", action="append", help="PIPELINE a ejecutar con --run; repetible")
    parser.add_argument("--base-dir", type=Path, help="Base de rutas SOURCE/SINK (por defecto: carpeta del .etl)")
    args = parser.parse_args(argv)
    if args.run and args.format != "python":
        parser.error("--run requiere --format python")
    if args.pipeline and not args.run:
        parser.error("--pipeline requiere --run")
    if args.no_opt and args.pases is not None:
        parser.error("-O0 y --pases son excluyentes")
    passes = () if args.no_opt else DEFAULT if args.pases is None else \
        tuple(name.strip() for name in args.pases.split(",") if name.strip())
    unknown = [name for name in passes if name not in PASSES]
    if unknown:
        parser.error(f"pases desconocidos: {', '.join(unknown)}; disponibles: {', '.join(PASSES)}")
    directory = args.input.is_dir()
    if not args.input.exists():
        print(f"No existe la entrada: {args.input}", file=sys.stderr)
        return 1
    paths = (sorted(path for path in args.input.rglob("*")
                    if path.is_file() and path.suffix.lower() == ".etl")
             if directory else [args.input])
    if not paths:
        print(f"No se encontraron archivos .etl en {args.input}.", file=sys.stderr)
        return 1
    fmt = args.format
    output = args.output if args.output is not None else (Path("output") if directory or fmt == "python" else None)
    suffixes = {"python": ".py", "ast": ".ast.json", "ir": ".ir.txt", "tree": ".tree.txt", "tokens": ".tokens.json"}
    failures = 0
    for path in paths:
        try:
            result = _analyze(path, fmt, args.base_dir, passes)
            if output is not None and fmt != "check":
                relative = path.relative_to(args.input) if directory else Path(path.name)
                destination = output / relative.with_suffix(suffixes[fmt])
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(result, encoding="utf-8")
                print(f"OK: {path} -> {destination}")
            else:
                print(result, end="")
            if args.run:
                from .runtime import PolarsRuntime, run_pipelines

                namespace = {"__name__": "etl_generated"}
                exec(compile(result, str(destination), "exec"), namespace)
                with PolarsRuntime(args.base_dir or path.resolve().parent) as rt:
                    results = run_pipelines(rt, namespace["PIPELINES"], namespace["DEFAULT_PIPELINES"], args.pipeline)
                    for name in results:
                        print(f"POLARS: PIPELINE {name} ejecutado.")
                    for sink in rt.written:
                        print(f"SINK: {sink}")
        except (OSError, UnicodeError, ParseError, ValueError) as exc:
            print(exc, file=sys.stderr)
            failures += 1
    if directory:
        print(f"Procesados: {len(paths)}; correctos: {len(paths) - failures}; errores: {failures}.")
    return 1 if failures else 0
