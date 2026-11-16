"""Ejecutor en proceso separado. No constituye una barrera de seguridad para Python."""
from contextlib import redirect_stdout
import ast
import io
import json
from pathlib import Path
import sys
import traceback

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from benchmark import columns, compare, dump, expected


def input_frames(task, case):
    import polars as pl
    types = {"INT": pl.Int64, "DECIMAL": pl.Float64, "STRING": pl.String,
             "BOOL": pl.Boolean, "DATE": pl.Date, "DATETIME": pl.Datetime}
    return {table: pl.DataFrame(case["input"][table],
                               schema={name: types[kind.rstrip("?")] for name, kind in columns(definition)},
                               strict=True)
            for table, definition in task["input_schema"].items()}


def capybara(code, task):
    import polars as pl
    from etl_dsl.api import compile_source
    from etl_dsl.runtime import PolarsRuntime, run_pipelines

    base = Path.cwd()
    compiled = compile_source(code, base_dir=base)
    if not compiled["ok"]:
        syntax_ok = all(d["stage"] not in {"lexical", "syntax"} for d in compiled["diagnostics"])
        return {"status": "compile_error", "syntax_ok": syntax_ok, "pass_all": False, "diagnostics": compiled["diagnostics"]}
    cases = []
    for index, case in enumerate(task["test_cases"]):
        directory = base / f"case-{index}"
        (directory / "input").mkdir(parents=True)
        for table, frame in input_frames(task, case).items():
            frame.write_parquet(directory / "input" / f"{table}.parquet")
        # El backend fija base_dir al generar: se compila con el directorio del test.
        current = compile_source(code, base_dir=directory)
        local = {"__name__": "capybara_benchmark"}
        exec(compile(current["code"], "generated.py", "exec"), local)
        try:
            with PolarsRuntime(directory, root=directory) as runtime:
                run_pipelines(runtime, local["PIPELINES"], local["DEFAULT_PIPELINES"])
            output = directory / "output.parquet"
            actual = pl.read_parquet(output).to_dicts()
            cases.append({"passed": compare(actual, expected(case)), "actual": actual})
        except Exception as exc:
            cases.append({"passed": False, "error": f"{type(exc).__name__}: {exc}"})
    passed = all(c["passed"] for c in cases)
    errors = any("error" in c for c in cases)
    return {"status": "passed" if passed else "runtime_error" if errors else "wrong_output", "syntax_ok": True, "pass_all": passed, "tests": cases}


def python(code, task, use_polars=False):
    try:
        compiled = compile(code, "candidate.py", "exec")
    except SyntaxError as exc:
        return {"status": "compile_error", "syntax_ok": False, "pass_all": False, "error": str(exc)}
    if use_polars:
        tree = ast.parse(code)
        imports_polars = any(
            isinstance(node, ast.Import) and any(alias.name.split('.')[0]=='polars' for alias in node.names)
            or isinstance(node, ast.ImportFrom) and (node.module or '').split('.')[0]=='polars'
            for node in ast.walk(tree))
        if not imports_polars:
            return {"status": "contract_error", "syntax_ok": True, "pass_all": False,
                    "error": "La variante Polars exige importar polars y devolver un DataFrame o LazyFrame."}
    cases = []
    for case in task["test_cases"]:
        namespace = {"__name__": "python_benchmark"}
        try:
            exec(compiled, namespace)
            # Copia independiente: una respuesta no puede mutar el siguiente test.
            inputs = input_frames(task, case) if use_polars else json.loads(json.dumps(case["input"]))
            actual = namespace["transform"](inputs)
            if use_polars:
                import polars as pl
                if isinstance(actual, pl.LazyFrame):
                    actual = actual.collect()
                if not isinstance(actual, pl.DataFrame):
                    cases.append({"passed": False, "contract_error": True,
                                  "error": "transform(data) debe devolver un DataFrame o LazyFrame de Polars."})
                    continue
                actual = actual.to_dicts()
            cases.append({"passed": compare(actual, expected(case)), "actual": actual})
        except Exception as exc:
            cases.append({"passed": False, "error": f"{type(exc).__name__}: {exc}"})
    passed = all(c["passed"] for c in cases)
    errors = any("error" in c for c in cases)
    contracts = any(c.get("contract_error") for c in cases)
    return {"status": "passed" if passed else "contract_error" if contracts else "runtime_error" if errors else "wrong_output", "syntax_ok": True, "pass_all": passed, "tests": cases}


def main():
    job, destination = map(Path, sys.argv[1:])
    payload = json.loads(job.read_text(encoding="utf-8"))
    try:
        with redirect_stdout(io.StringIO()):
            if payload["language"] == "capybara":
                result = capybara(payload["code"], payload["task"])
            else:
                result = python(payload["code"], payload["task"], use_polars=payload["language"]=="polars")
        dump(destination, result)
    except Exception:
        dump(destination, {"status": "worker_error", "pass_all": False, "error": traceback.format_exc()[-3000:]})


if __name__ == "__main__":
    main()
