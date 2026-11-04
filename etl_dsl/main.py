"""Entrada del compilador: procesa archivos individuales o una carpeta de entrada."""
import argparse
import json
from pathlib import Path
import sys

from .ast import to_dict
from .backend import compile_program
from .diagnostics import ParseError
from .parser import parse_tree
from .scanner import scan
from .validation import validate
from .visitor import ASTBuilder


def _analyze(path: Path, fmt: str, base_dir=None) -> str:
    source = path.read_text(encoding="utf-8-sig")
    tree = parse_tree(source, filename=str(path))
    program = ASTBuilder().transform(tree)
    issues = validate(program)
    if issues:
        for issue in issues:
            print(issue.format(source, str(path)), file=sys.stderr)
        raise ValueError(f"{path}: {len(issues)} error(es) de validación.")
    if fmt == "python":
        return compile_program(program, filename=str(path), base_dir=base_dir or path.resolve().parent)
    if fmt == "ast":
        return json.dumps(to_dict(program), ensure_ascii=True, indent=2) + "\n"
    if fmt == "tokens":
        return json.dumps([to_dict(token) for token in scan(source, filename=str(path))], indent=2) + "\n"
    if fmt == "tree":
        return tree.pretty()
    return f"OK: {path}: {len(program.pipelines)} pipeline(s); sintaxis y estructura válidas.\n"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Compilador del DSL ETL para DuckDB")
    parser.add_argument("input", nargs="?", type=Path, default=Path("input"),
                        help="Archivo .etl o carpeta de programas (por defecto: input)")
    parser.add_argument("--output", "-o", type=Path,
                        help="Carpeta de salida (por defecto: output al procesar una carpeta)")
    parser.add_argument("--format", choices=("python", "check", "ast", "tree", "tokens"), default="python",
                        help="Salida del compilador (por defecto: python)")
    parser.add_argument("--run", action="store_true", help="Ejecutar con DuckDB después de generar Python")
    parser.add_argument("--pipeline", action="append", help="PIPELINE a ejecutar con --run; repetible")
    parser.add_argument("--base-dir", type=Path, help="Base de rutas SOURCE/SINK (por defecto: carpeta del .etl)")
    args = parser.parse_args(argv)
    if args.run and args.format != "python":
        parser.error("--run requiere --format python")
    if args.pipeline and not args.run:
        parser.error("--pipeline requiere --run")
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
    suffixes = {"python": ".py", "ast": ".ast.json", "tree": ".tree.txt", "tokens": ".tokens.json"}
    failures = 0
    for path in paths:
        try:
            result = _analyze(path, fmt, args.base_dir)
            if output is not None and fmt != "check":
                relative = path.relative_to(args.input) if directory else Path(path.name)
                destination = output / relative.with_suffix(suffixes[fmt])
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(result, encoding="utf-8")
                print(f"OK: {path} -> {destination}")
            else:
                print(result, end="")
            if args.run:
                from .runtime import DuckDBRuntime, run_pipelines

                namespace = {"__name__": "etl_generated"}
                exec(compile(result, str(destination), "exec"), namespace)
                with DuckDBRuntime(args.base_dir or path.resolve().parent) as rt:
                    results = run_pipelines(rt, namespace["PIPELINES"], namespace["DEFAULT_PIPELINES"], args.pipeline)
                    for name in results:
                        print(f"DUCKDB: PIPELINE {name} ejecutado.")
                    for sink in rt.written:
                        print(f"SINK: {sink}")
        except (OSError, UnicodeError, ParseError, ValueError) as exc:
            print(exc, file=sys.stderr)
            failures += 1
    if directory:
        print(f"Procesados: {len(paths)}; correctos: {len(paths) - failures}; errores: {failures}.")
    return 1 if failures else 0
