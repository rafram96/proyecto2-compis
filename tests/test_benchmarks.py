"""Pruebas C5 pequeñas: sin campañas largas ni aserciones de velocidad."""
import csv
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import polars as pl

from benchmarks import baselines
from benchmarks.correctness import equivalent, check_contract_errors, check_static_errors
from benchmarks.data import generate, describe, edge_inputs
from benchmarks.harness import (CONFIGURATIONS, EXPECTED, PROGRAMS, SCENARIOS,
                                compile_source, execute, load_pipeline, run, structural_record)
from benchmarks.report import percentile, summarize


ROOT = Path(__file__).resolve().parents[1]


def compiled(workload):
    source = (PROGRAMS / f"{workload}.etl").read_text(encoding="utf-8")
    return {c: load_pipeline(compile_source(source, workload, passes))
            for c, passes in CONFIGURATIONS.items()}


class BenchmarkTests(unittest.TestCase):
    def test_generator_reproducible_and_typed_empty(self):
        self.assertEqual(describe(generate(32, 1)), describe(generate(32, 1)))
        self.assertNotEqual(describe(generate(32, 1)), describe(generate(32, 2)))
        empty = generate(0, 1)
        self.assertEqual(empty["ventas"].height, 0)
        self.assertEqual(empty["ventas"].schema, generate(32, 1)["ventas"].schema)
        with self.assertRaises(ValueError):
            generate(-1, 1)

    def test_all_configurations_baselines_and_real_rewrite_opportunities(self):
        frames = generate(32, 3)
        for workload in EXPECTED:
            source = (PROGRAMS / f"{workload}.etl").read_text(encoding="utf-8")
            expected = execute(baselines.BASELINES[workload], frames, "normal")
            for configuration, passes in CONFIGURATIONS.items():
                with self.subTest(workload=workload, configuration=configuration):
                    result = compile_source(source, workload, passes, structure=True)
                    record = structural_record(workload, configuration, result)
                    equivalent(expected, execute(load_pipeline(result), frames, "normal"),
                               ordered=workload != "control_sin_garantia")
                    if configuration == "joins":
                        self.assertEqual(record["join_rewrites"], int(workload in ("join", "combinado")))
                    if workload == "rangos" and configuration == "rangos":
                        self.assertGreater(record["range_rewrites"], 0)
                    if workload == "control_limites" and configuration == "rangos":
                        self.assertFalse(record["changed"])

    def test_comparator_detects_values_types_columns_nulls_and_multiplicity(self):
        left = pl.DataFrame({"a": [1.0, None, float("nan"), 1.0], "b": [1, 2, 3, 1]})
        equivalent({"o": left}, {"o": left.reverse()}, ordered=False)
        bad = [left.head(3), left.select("b", "a"), left.cast({"b": pl.Int32}),
               left.with_columns(pl.col("a").fill_null(0)),
               left.with_columns(pl.when(pl.col("b") == 3).then(10).otherwise(pl.col("b")).alias("b")),
               # Igual cantidad de filas y mismos valores distintos, distinta multiplicidad.
               pl.concat([left.head(3), left.slice(1, 1)])]
        for actual in bad:
            with self.subTest(actual=actual), self.assertRaises(AssertionError):
                equivalent({"o": left}, {"o": actual}, ordered=False)
        with self.assertRaises(AssertionError):
            equivalent({"o": left}, {"o": left.reverse()}, ordered=True)
        with self.assertRaises(AssertionError):
            equivalent({"o": left}, {"otro": left})

    def test_empty_all_null_and_sql_aggregation_oracle(self):
        funcs = compiled("agregados")
        funcs["manual"] = baselines.agregados
        for case, frames in edge_inputs():
            expected = execute(funcs["O0"], frames, "normal")
            for scenario in SCENARIOS:
                for fn in funcs.values():
                    equivalent(expected, execute(fn, frames, scenario))
            if case in ("izquierda_vacia", "ambas_vacias"):
                self.assertEqual(expected["totales"].rows(), [(None, 0, 0)])
                self.assertEqual(expected["resultado"].height, 0)
            if case == "medidas_nulas":
                self.assertEqual(expected["totales"].rows(), [(None, 32, 0)])
        # Oracle concreto, independiente del generador y del backend.
        data = generate(0, 1)
        data["ventas"] = pl.DataFrame({"id": [3, 1, 2], "cliente": [0, 0, 1],
            "monto": [None, 5.0, None], "etiqueta": ["a", "b", "a"]},
            schema=generate(1, 1)["ventas"].schema)
        for fn in funcs.values():
            result = execute(fn, data, "normal")
            self.assertEqual(result["resultado"].rows(), [("a", None, 2, 0), ("b", 5.0, 1, 1)])
            self.assertEqual(result["totales"].rows(), [(5.0, 3, 1)])

    def test_c4_baseline_and_every_configuration_preserve_errors(self):
        functions = {}
        for workload in ("join", "combinado", "control_join"):
            functions[workload] = {**compiled(workload), "manual": baselines.BASELINES[workload]}
        errors = check_contract_errors(functions, execute)
        self.assertEqual(len(errors), 3 * 11 * 8)
        self.assertTrue(all(r["expected"] == r["observed"] for r in errors))

    def test_static_corpus_and_plain_polars_controls(self):
        sources = {n: (PROGRAMS / f"{n}.etl").read_text(encoding="utf-8") for n in ("rangos", "join")}
        errors = check_static_errors(sources, CONFIGURATIONS)
        self.assertEqual(len(errors), 3 * 7)
        self.assertTrue(all(r["plain_polars"].startswith("al materializar:") for r in errors))

    def test_c4_left_order_both_keys_and_duplicate_rows(self):
        frames = generate(32, 7)
        frames["ventas"] = pl.concat([frames["ventas"]] * 2)
        for workload in ("join", "control_join"):
            for fn in (*compiled(workload).values(), baselines.BASELINES[workload]):
                result = execute(fn, frames, "normal")["resultado"]
                self.assertEqual(result["id"].to_list(), frames["ventas"]["id"].to_list())
                self.assertEqual(result["cliente"].to_list(), frames["ventas"]["cliente"].to_list())
                if workload == "control_join":
                    self.assertEqual(result.columns, ["id", "cliente", "clave", "monto", "nombre"])
                    self.assertEqual(result["clave"].to_list(), result["cliente"].to_list())

    def test_engine_control_is_only_on_final_collect(self):
        fn = compiled("join")["O0"]
        original = pl.LazyFrame.collect
        calls = []

        def collect(frame, *args, **kwargs):
            calls.append(kwargs)
            return original(frame, *args, **kwargs)

        with patch.object(pl.LazyFrame, "collect", new=collect):
            execute(fn, generate(16, 1), "final_flags_none")
        self.assertIn("optimizations", calls[-1])
        self.assertEqual(str(calls[-1]["optimizations"]), str(pl.QueryOptFlags.none()))
        self.assertGreaterEqual(sum(not call for call in calls[:-1]), 5)  # INPUT x2, snapshots x2 y anti join

    def test_failed_equivalence_publishes_no_measurements(self):
        def wrong(rt, frames):
            return {"resultado": frames["ventas"].lazy().select("id")}

        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "failed"
            with patch.dict(baselines.BASELINES, {"rangos": wrong}), self.assertRaises(AssertionError):
                run(output, sizes=(16,), repetitions=1, warmups=0, progress=False)
            self.assertFalse(output.exists())

    def test_statistics_have_defined_iqr_and_reference(self):
        self.assertEqual(percentile([1, 2, 3, 4], .25), 1.75)
        samples = [{"phase": "execute", "workload": "p", "size": 10, "seed": 2,
            "configuration": config, "passes": "", "scenario": "normal", "unit": "ms", "value": value}
            for config, values in (("O0", [2, 4, 6]), ("manual", [1, 2, 3])) for value in values]
        rows = summarize(samples)
        self.assertEqual(rows[0]["median"], 4)
        self.assertEqual(rows[0]["iqr"], 2)
        self.assertEqual(rows[1]["speedup_vs_O0"], 2)

    def test_small_mode_cli_exports_real_results_and_recomputable_summary(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "small"
            cmd = [sys.executable, "-m", "benchmarks", "--mode", "small", "--threads", "2",
                   "--output", str(output)]
            # El proceso nuevo debe fijar el pool incluso si hereda otra variable.
            result = subprocess.run(cmd, cwd=ROOT, env={**os.environ, "POLARS_MAX_THREADS": "7"},
                                    capture_output=True, text=True, timeout=60)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            meta = json.loads((output / "metadata.json").read_text())
            self.assertEqual(meta["status"], "valid")
            self.assertEqual(meta["environment"]["polars_threads"], 2)
            self.assertEqual(meta["environment"]["environment"]["POLARS_MAX_THREADS"], "2")
            self.assertEqual(meta["contract_checks"], 285)
            with (output / "samples.csv").open() as stream:
                samples = list(csv.DictReader(stream))
            self.assertEqual(len(samples), 8 * (7 + 8 * 2) * 2)
            self.assertEqual({r["unit"] for r in samples}, {"ms"})
            self.assertEqual({r["phase"] for r in samples}, {"compile", "execute"})
            self.assertEqual({r["scenario"] for r in samples if r["phase"] == "execute"}, set(SCENARIOS))
            for row in samples:
                row["value"] = float(row["value"])
            with (output / "summary.csv").open() as stream:
                summaries = list(csv.DictReader(stream))
            rebuilt = summarize(samples)
            self.assertEqual(len(rebuilt), len(summaries))
            for got, expected in zip(summaries, rebuilt):
                self.assertEqual(float(got["median"]), expected["median"])
                self.assertEqual(float(got["iqr"]), expected["iqr"])
            proof = json.loads((output / "structure.json").read_text())
            self.assertEqual(len(proof), 8 * 7)
            self.assertTrue(any(r["join_rewrites"] == 1 for r in proof))
            self.assertIn("No es Polars sin optimización", (output / "report.md").read_text())
            # Repetir sobre un destino ocupado no mezcla ni pisa campañas.
            second = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(second.returncode, 0)
