"""Arnés C5: API pública, corrección obligatoria y publicación solo tras éxito total."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import inspect
import json
import os
from pathlib import Path
import platform
import random
import subprocess
import sys
import tempfile
from time import perf_counter_ns

import polars as pl
import lark

from etl_dsl import analyze
from etl_dsl.passes import DEFAULT
from etl_dsl.runtime import PolarsRuntime
from etl_dsl.version import COMPILER_VERSION, CONTRACT_VERSION
from . import baselines
from .correctness import equivalent, check_contract_errors, check_static_errors
from .data import generate, describe, edge_inputs
from .report import export


ROOT = Path(__file__).resolve().parents[1]
PROGRAMS = Path(__file__).parent / "programs"
CONFIGURATIONS = {"O0": (), **{p: (p,) for p in DEFAULT}, "default": DEFAULT}
SCENARIOS = ("normal", "final_flags_none")
# Cambios de operadores/expresiones esperados con cada pase AISLADO. Las
# anotaciones de hechos no cuentan como transformación de un programa.
EXPECTED = {
    "rangos": {"rangos", "filtros"},
    "clasicas": {"constantes", "filtros", "muertos"},
    "join": {"joins"},
    "combinado": set(DEFAULT),
    "control_limites": {"filtros"},
    "control_join": set(),
    "control_sin_garantia": set(),
    "agregados": set(),
}


def compile_source(source, workload, passes, *, structure=False):
    artifacts = ("python", "ir_before", "ir_after") if structure else ("python",)
    result = analyze(source, filename=f"benchmarks/programs/{workload}.etl",
                     base_dir=ROOT, passes=passes, artifacts=artifacts)
    if not result.ok:
        raise AssertionError([d.to_dict(result.filename) for d in result.diagnostics])
    return result


def load_pipeline(result):
    scope = {"__name__": "cauce_benchmark"}
    exec(compile(result.artifacts["python"].data, "<cauce_benchmark>", "exec"), scope)
    return scope["PIPELINES"]["p"]


def structural_record(workload, configuration, result):
    before = result.artifacts["ir_before"].data["module"]
    after = result.artifacts["ir_after"].data["module"]
    original = {n["name"]: n for p in before["pipelines"] for n in p["nodes"]}
    final = {n["name"]: n for p in after["pipelines"] for n in p["nodes"]}
    removed = sorted(original.keys() - final.keys())
    added = sorted(final.keys() - original.keys())
    modified = sorted(n for n in original.keys() & final.keys() if original[n] != final[n])
    changed = bool(removed or added or modified)
    expected = bool(EXPECTED[workload]) if configuration == "default" else configuration in EXPECTED[workload]
    if changed != expected:
        raise AssertionError(f"{workload}/{configuration}: transformación {changed}, esperada {expected}")
    return {"workload": workload, "configuration": configuration,
            "passes": list(result.passes), "nodes_before": len(original), "nodes_after": len(final),
            "changed": changed, "removed": removed, "added": added, "modified": modified,
            "range_rewrites": len(after["range_rewrites"]), "join_rewrites": len(after["join_rewrites"]),
            "operators_before": dict(Counter(n["kind"] for n in original.values())),
            "operators_after": dict(Counter(n["kind"] for n in final.values())),
            "before": before, "after": after}


def execute(fn, frames, scenario):
    """TODO el trabajo de runtime, incluida la construcción/validación anterior a collect."""
    rt = PolarsRuntime()
    plans = fn(rt, frames)
    if scenario == "normal":
        return {name: rt.collect(plan) for name, plan in plans.items()}
    if scenario == "final_flags_none":
        return {name: plan.collect(optimizations=pl.QueryOptFlags.none()) for name, plan in plans.items()}
    raise ValueError(scenario)


def command(*args):
    try:
        return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def environment():
    paths = sorted((ROOT / "etl_dsl").glob("*.py")) + [ROOT / "etl_dsl/grammar.lark"]
    paths += sorted(Path(__file__).parent.glob("*.py")) + sorted(PROGRAMS.glob("*.etl"))
    return {
        "python": sys.version, "python_executable": sys.executable,
        "polars": pl.__version__, "lark": lark.__version__,
        "compiler_version": COMPILER_VERSION, "contract_version": CONTRACT_VERSION,
        "git_revision": command("git", "rev-parse", "HEAD"),
        "git_status": command("git", "status", "--short"),
        "source_sha256": {str(p.relative_to(ROOT)): sha256(p.read_bytes()).hexdigest() for p in paths},
        "platform": platform.platform(), "machine": platform.machine(),
        "cpu": command("sysctl", "-n", "machdep.cpu.brand_string") or platform.processor(),
        "logical_cpu_count": os.cpu_count(), "memory_bytes": command("sysctl", "-n", "hw.memsize"),
        "polars_threads": pl.thread_pool_size(),
        "environment": {k: v for k, v in os.environ.items()
                        if k.startswith("POLARS_") or k in ("OMP_NUM_THREADS", "RAYON_NUM_THREADS", "PYTHONHASHSEED")},
        "collect_signature": str(inspect.signature(pl.LazyFrame.collect)),
        "query_opt_flags_none": str(pl.QueryOptFlags.none()) if hasattr(pl, "QueryOptFlags") else None,
        "query_opt_flags_default": str(pl.QueryOptFlags()) if hasattr(pl, "QueryOptFlags") else None,
    }


def expressivity(sources, structures):
    def loc(source):
        return sum(bool(line.strip()) and not line.lstrip().startswith(("#", "//"))
                   for line in source.splitlines())
    shared = sum(loc(inspect.getsource(fn)) for fn in
                 (baselines.inputs, baselines.output, baselines.sql_sum))
    return [{"workload": name, "dsl_nonblank_noncomment_lines": loc(source),
             "manual_function_lines": loc(inspect.getsource(baselines.BASELINES[name])),
             "manual_shared_helper_lines": shared,
             "dsl_nodes": next(r["nodes_before"] for r in structures if r["workload"] == name)}
            for name, source in sources.items()]


def run(output, *, sizes=(64,), seed=20261111, repetitions=2, warmups=1,
        scenarios=SCENARIOS, threads=None, mode="small", progress=True):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError(f"El directorio de salida ya existe: {output}; elija otro para evitar mezclar campañas")
    if (not sizes or min(sizes) < 0 or len(set(sizes)) != len(sizes) or repetitions < 1
            or warmups < 0 or not scenarios or not set(scenarios) <= set(SCENARIOS)
            or len(set(scenarios)) != len(scenarios)):
        raise ValueError("Parámetros de campaña inválidos")
    if threads is not None and threads != pl.thread_pool_size():
        raise ValueError("El pool de Polars ya se inicializó con otro número de hilos; inicie un proceso nuevo")
    if "final_flags_none" in scenarios and (not hasattr(pl, "QueryOptFlags") or
            "optimizations" not in inspect.signature(pl.LazyFrame.collect).parameters):
        raise ValueError("Esta versión no ofrece collect(optimizations=QueryOptFlags.none()); use --scenarios normal")
    metadata = {"format_version": 1, "status": "running",
                "started_utc": datetime.now(timezone.utc).isoformat(),
                "mode": mode, "sizes": list(sizes), "seed": seed,
                "repetitions": repetitions, "warmups": warmups, "scenarios": list(scenarios),
                "configurations": {k: list(v) for k, v in CONFIGURATIONS.items()},
                "environment": environment(), "clock": "time.perf_counter_ns", "unit": "ms",
                "dispersion": "IQR = percentile75 - percentile25; interpolación lineal (n-1)*p",
                "input_scenario": "in_memory; mismos DataFrames inmutables; sin IO de conectores",
                "compile_scope": "analyze(artifacts=('python',)): scanner, parsing, AST, validación, lowering, inferencia, pases y generación",
                "compile_excludes": "importaciones, lectura del .etl, serialización IR, compile/exec CPython del Python generado",
                "execution_scope": "nuevo runtime, invocación pipeline/baseline, contratos, validaciones C4 completas, materialización de cada salida",
                "execution_excludes": "generación de datos, compilación DSL, carga del Python, comparación y exportación",
                "engine_options": {
                    "normal": {"final_outputs": "collect() por defecto, engine=auto", "runtime_internal": "collect() por defecto, engine=auto"},
                    "final_flags_none": {"final_outputs": "collect(optimizations=pl.QueryOptFlags.none()), engine=auto",
                                         "runtime_internal": "collect() por defecto: contratos, snapshots y anti join C4 conservan optimizaciones habituales"}},
                "row_comparison": {n: "canonical_all_columns" if n == "control_sin_garantia" else "ordered" for n in EXPECTED},
                "order": "random.Random(seed); shuffle configuraciones compilación y pares configuración/escenario por ronda; orden de workload y tamaños declarado",
                "cache_policy": "datos residentes compartidos; pipeline y planes nuevos por muestra, sin reutilizar resultados; sin vaciar cachés CPU/SO; GC habitual",
                "datasets": [], "equivalence": [], "samples_include_only_validated_results": True}
    rng = random.Random(seed)
    sources = {n: (PROGRAMS / f"{n}.etl").read_text(encoding="utf-8") for n in EXPECTED}
    functions, structures, samples = {}, [], []

    def sample(phase, workload, size, configuration, scenario, repetition, elapsed):
        samples.append({"sequence": len(samples) + 1, "phase": phase, "workload": workload,
                        "size": size, "seed": seed, "configuration": configuration,
                        "passes": ",".join(CONFIGURATIONS.get(configuration, ())),
                        "scenario": scenario, "repetition": repetition, "unit": "ms", "value": elapsed / 1_000_000})

    # Estructura y equivalencia de esquinas ANTES de iniciar cualquier medición.
    for name, source in sources.items():
        functions[name] = {}
        for configuration, passes in CONFIGURATIONS.items():
            result = compile_source(source, name, passes, structure=True)
            functions[name][configuration] = load_pipeline(result)
            structures.append(structural_record(name, configuration, result))
        functions[name]["manual"] = baselines.BASELINES[name]
        for case, frames in edge_inputs():
            expected = execute(functions[name]["O0"], frames, "normal")
            for scenario in scenarios:
                for configuration, fn in functions[name].items():
                    equivalent(expected, execute(fn, frames, scenario), ordered=name != "control_sin_garantia")
                    metadata["equivalence"].append({"workload": name, "case": case,
                        "configuration": configuration, "scenario": scenario, "valid": True})
    errors = check_contract_errors(functions, execute) + check_static_errors(sources, CONFIGURATIONS)

    for name, source in sources.items():
        if progress:
            print(f"{name}: equivalencia de esquinas/contratos OK; midiendo compilación y {list(sizes)} filas", flush=True)
        for repetition in range(-warmups + 1, repetitions + 1):
            configurations = list(CONFIGURATIONS)
            rng.shuffle(configurations)
            for configuration in configurations:
                start = perf_counter_ns()
                result = compile_source(source, name, CONFIGURATIONS[configuration])
                elapsed = perf_counter_ns() - start
                if repetition > 0:
                    sample("compile", name, 0, configuration, "not_applicable", repetition, elapsed)
                result = None
        for size in sizes:
            frames = generate(size, seed)
            manifest = describe(frames)
            metadata["datasets"].append({"workload": name, "size": size, "seed": seed, "tables": manifest})
            expected = execute(functions[name]["O0"], frames, "normal")
            cases = [(configuration, scenario) for configuration in functions[name] for scenario in scenarios]
            for configuration, scenario in cases:
                equivalent(expected, execute(functions[name][configuration], frames, scenario),
                           ordered=name != "control_sin_garantia")
                metadata["equivalence"].append({"workload": name, "case": f"size={size}",
                    "configuration": configuration, "scenario": scenario, "valid": True})
            for repetition in range(-warmups + 1, repetitions + 1):
                rng.shuffle(cases)
                for configuration, scenario in cases:
                    start = perf_counter_ns()
                    actual = execute(functions[name][configuration], frames, scenario)
                    elapsed = perf_counter_ns() - start
                    # También detecta resultados inestables DESPUÉS de cada muestra.
                    equivalent(expected, actual, ordered=name != "control_sin_garantia")
                    actual = None
                    if repetition > 0:
                        sample("execute", name, size, configuration, scenario, repetition, elapsed)
            if describe(frames) != manifest:
                raise AssertionError(f"{name}/{size}: se mutaron los datos durante la campaña")
    metadata["status"] = "valid"
    metadata["finished_utc"] = datetime.now(timezone.utc).isoformat()
    metadata["contract_checks"] = len(errors)
    metadata["expressivity"] = expressivity(sources, structures)
    # No se publican muestras parciales si cualquier configuración es incorrecta.
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".cauce-c5-", dir=output.parent) as temporary:
        stage = Path(temporary) / "run"
        stage.mkdir()
        export(stage, samples, structures, errors, metadata)
        stage.rename(output)
    return metadata
