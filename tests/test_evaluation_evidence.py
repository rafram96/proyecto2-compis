"""Evidencia C5 publicada: integridad, fidelidad numérica y reproducibilidad sin benchmarks/results/."""
import csv
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from benchmarks.evidence import (EvidenceError, REDACTED, digest, load, load_snapshot, publish,
                                 redact_metadata, validate, verify_originals)
from benchmarks.report import percentile
from web.scripts.gen_evaluation import CURATION, DEST, ROOT, build, curation, serialized

SNAPSHOT = ROOT / "web/public/evidencia/c5-representativa"
ORIGINALS = ROOT / "benchmarks/results/representativa"


def rewrite_csv(path, change):
    with path.open(encoding="utf-8", newline="") as stream:
        reader = csv.DictReader(stream)
        fields, rows = reader.fieldnames, list(reader)
    rows = change(rows)
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    path.write_text(out.getvalue(), encoding="utf-8", newline="")


class EvidenceSnapshotTests(unittest.TestCase):
    def test_snapshot_is_complete_and_generated_page_is_current(self):
        manifest, campaign, raw = load_snapshot(SNAPSHOT)
        self.assertEqual(manifest["campaign"]["counts"], {"samples": 4400, "cells": 440, "structure": 56,
                                                          "errors": 285, "equivalence": 1024})
        self.assertEqual(manifest["campaign"]["measured_revision"], "efe13996d9201788c9fc8cd7c6f458ca68035a04")
        self.assertEqual([f["path"] for f in manifest["files"]], [f["path"] for f in curation()["files"]])
        for entry in manifest["files"]:
            self.assertEqual(digest(raw[entry["path"]]), entry["sha256"])
            self.assertEqual(entry["identical_to_original"], entry["path"] != "metadata.public.json")
        self.assertEqual(DEST.read_text(encoding="utf-8"), serialized())

    def test_build_uses_only_the_versioned_snapshot(self):
        # Copia aislada: ningún archivo de benchmarks/results/ participa en la generación.
        with tempfile.TemporaryDirectory() as temp:
            copy = Path(temp) / "snapshot"
            shutil.copytree(SNAPSHOT, copy)
            self.assertEqual(build(copy), json.loads(DEST.read_text(encoding="utf-8")))
            self.assertEqual(serialized(copy), serialized())

    @unittest.skipUnless((ROOT / ".git").exists() and shutil.which("git"), "requiere checkout Git")
    def test_published_files_are_not_ignored(self):
        paths = [str(SNAPSHOT.relative_to(ROOT) / p) for p in ["manifest.json", *(f["path"] for f in curation()["files"])]]
        paths += [str(DEST.relative_to(ROOT)), str(CURATION.relative_to(ROOT))]
        ignored = subprocess.run(["git", "check-ignore", "--no-index", *paths], cwd=ROOT,
                                 capture_output=True, text=True).stdout.split()
        self.assertEqual(ignored, [])

    def test_page_cells_match_csv_and_protocol(self):
        data = json.loads(DEST.read_text(encoding="utf-8"))
        with (SNAPSHOT / "summary.csv").open(encoding="utf-8") as stream:
            summary = {(r["phase"], r["workload"], int(r["size"]), r["scenario"], r["configuration"]): r
                       for r in csv.DictReader(stream)}
        cells = {(c["phase"], c["workload"], c["size"], c["scenario"], c["configuration"]): c for c in data["cells"]}
        self.assertEqual(set(cells), set(summary))
        compile_cells = [c for c in data["cells"] if c["phase"] == "compile"]
        self.assertEqual(len(compile_cells), 56)
        self.assertTrue(all(c["size"] == 0 and c["scenario"] == "not_applicable" for c in compile_cells))
        self.assertNotIn("manual", {c["configuration"] for c in compile_cells})
        self.assertEqual(len(data["cells"]) - 56, 8 * 3 * 2 * 8)
        for key, cell in cells.items():
            row = summary[key]
            for field in ("median", "p25", "p75", "iqr", "min", "max"):
                self.assertEqual(cell[field], float(row[field]))
            self.assertEqual(cell["ratio"], float(row["speedup_vs_O0"]))
            values = cell["samples"]
            self.assertEqual(len(values), cell["n"])
            self.assertEqual(cell["iqr"], percentile(values, .75) - percentile(values, .25))
            self.assertEqual((cell["min"], cell["max"]), (min(values), max(values)))
            # Razón dentro de la misma fase, workload, tamaño y escenario; nunca entre celdas distintas.
            o0 = cells[(*key[:4], "O0")]
            self.assertEqual(cell["ratio"], o0["median"] / cell["median"])
        self.assertTrue(all(c["ratio"] == 1.0 for c in data["cells"] if c["configuration"] == "O0"))

    def test_structure_errors_and_scenarios_are_separate_evidence(self):
        data = json.loads(DEST.read_text(encoding="utf-8"))
        join = next(s for s in data["structure"] if (s["workload"], s["configuration"]) == ("join", "joins"))
        self.assertEqual((join["nodes_before"], join["nodes_after"]), (5, 5))
        rewrite = join["join_rewrites"][0]
        self.assertEqual(rewrite["guarantee"], "VERIFY MANY_TO_ONE")
        self.assertIn("unique_right_key", rewrite["obligations"])
        self.assertIn("all_consumers_select_only_left_columns", rewrite["static_proof"])
        for control in ("control_join", "control_sin_garantia", "agregados"):
            self.assertFalse(any(s["changed"] for s in data["structure"] if s["workload"] == control))
        self.assertEqual(sum(len(e["configurations"]) for e in data["errors"]), 285)
        self.assertEqual(sum(len(e["configurations"]) for e in data["errors"] if e["phase"] == "compile"), 21)
        self.assertTrue(all(e["expected"] == e["observed"] for e in data["errors"]))
        self.assertEqual(data["campaign"]["engine_options"]["final_flags_none"]["runtime_internal"][:9], "collect()")
        self.assertTrue(data["campaign"]["flags"]["none"]["type_check"])
        self.assertFalse(data["campaign"]["flags"]["none"]["predicate_pushdown"])

    def test_metadata_redaction_is_explicit_and_minimal(self):
        public = (SNAPSHOT / "metadata.public.json").read_bytes()
        self.assertNotIn(b"/Users/", public)
        metadata = json.loads(public)
        self.assertEqual(metadata["environment"]["python_executable"], REDACTED)
        self.assertTrue(metadata["environment"]["python"].startswith("3.13.13"))
        sample = {"environment": {"python": "3", "python_executable": "/home/x/.venv/bin/python"}, "seed": 1}
        raw = (json.dumps(sample, indent=2, ensure_ascii=False) + "\n").encode()
        redacted, applied = redact_metadata(raw)
        self.assertEqual(json.loads(redacted), {"environment": {"python": "3", "python_executable": REDACTED}, "seed": 1})
        self.assertEqual([a["pointer"] for a in applied], ["/environment/python_executable"])
        with self.assertRaises(EvidenceError):
            redact_metadata(json.dumps(sample).encode())  # formato distinto: alteraría otros bytes

    @unittest.skipUnless(ORIGINALS.is_dir(), "originales ignorados ausentes en este checkout")
    def test_originals_match_manifest_when_present(self):
        manifest = json.loads((SNAPSHOT / "manifest.json").read_text(encoding="utf-8"))
        verify_originals(ORIGINALS, manifest)
        with tempfile.TemporaryDirectory() as temp:
            again = publish(ORIGINALS, Path(temp) / "s", curation())
            self.assertEqual(again, manifest)


class EvidenceCorruptionTests(unittest.TestCase):
    """Cada defecto produce un error comprensible; nada se completa con ceros."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.dir = Path(self.temp.name)
        for name in ("samples.csv", "summary.csv", "structure.csv", "structure.json", "errors.csv", "metadata.public.json"):
            shutil.copy(SNAPSHOT / name, self.dir / name)

    def tearDown(self):
        self.temp.cleanup()

    def expect(self, message):
        with self.assertRaises(EvidenceError) as caught:
            validate(load(self.dir, "metadata.public.json"))
        self.assertIn(message, str(caught.exception))

    def test_untouched_copy_validates(self):
        self.assertEqual(validate(load(self.dir, "metadata.public.json"))["samples"], 4400)

    def test_duplicate_missing_and_invalid_samples(self):
        cases = {
            "duplicada": lambda rows: rows + [rows[0]],
            "faltan": lambda rows: [r for r in rows if not (r["workload"] == "join" and r["configuration"] == "manual"
                                                             and r["size"] == "1000000")],
            "no es finito": lambda rows: [{**r, "value": "nan"} if i == 3 else r for i, r in enumerate(rows)],
            "no es numérico": lambda rows: [{**r, "value": "rápido"} if i == 3 else r for i, r in enumerate(rows)],
            "configuración 'O9' desconocida": lambda rows: [{**r, "configuration": "O9"} if i == 3 else r for i, r in enumerate(rows)],
            "celda incompatible": lambda rows: [{**r, "size": "10000"} if r["phase"] == "compile" and i < 20 else r
                                                for i, r in enumerate(rows)],
        }
        for message, change in cases.items():
            with self.subTest(message=message):
                shutil.copy(SNAPSHOT / "samples.csv", self.dir / "samples.csv")
                rewrite_csv(self.dir / "samples.csv", change)
                self.expect(message)

    def test_unknown_scenario_and_manual_compilation_are_rejected(self):
        def scenario(rows):
            row = next(r for r in rows if r["scenario"] == "normal")
            row["scenario"] = "sin_optimizar"
            return rows

        def manual(rows):
            row = next(r for r in rows if r["phase"] == "compile")
            row["configuration"], row["passes"] = "manual", ""
            return rows
        for change in (scenario, manual):
            with self.subTest(change=change.__name__):
                shutil.copy(SNAPSHOT / "samples.csv", self.dir / "samples.csv")
                rewrite_csv(self.dir / "samples.csv", change)
                self.expect("celda incompatible")

    def test_summary_must_equal_recalculation(self):
        rewrite_csv(self.dir / "summary.csv", lambda rows: [{**r, "median": str(float(r["median"]) * 0.5)} if i == 7 else r
                                                             for i, r in enumerate(rows)])
        self.expect("difiere del recálculo")
        shutil.copy(SNAPSHOT / "summary.csv", self.dir / "summary.csv")
        rewrite_csv(self.dir / "summary.csv", lambda rows: rows[:-1])
        self.expect("faltan 1 resúmenes")
        shutil.copy(SNAPSHOT / "summary.csv", self.dir / "summary.csv")
        rewrite_csv(self.dir / "summary.csv", lambda rows: rows + [rows[0]])
        self.expect("celda duplicada")

    def test_structure_errors_and_metadata_cross_references(self):
        rewrite_csv(self.dir / "structure.csv", lambda rows: [{**r, "nodes_after": "1"} if i == 2 else r for i, r in enumerate(rows)])
        self.expect("nodes_after no coincide")
        shutil.copy(SNAPSHOT / "structure.csv", self.dir / "structure.csv")
        rewrite_csv(self.dir / "errors.csv", lambda rows: [{**r, "observed": "E_OTRO"} if i == 0 else r for i, r in enumerate(rows)])
        self.expect("código observado")
        shutil.copy(SNAPSHOT / "errors.csv", self.dir / "errors.csv")
        rewrite_csv(self.dir / "errors.csv", lambda rows: rows[1:])
        self.expect("metadata declara 285")
        shutil.copy(SNAPSHOT / "errors.csv", self.dir / "errors.csv")
        metadata = json.loads((self.dir / "metadata.public.json").read_text(encoding="utf-8"))
        metadata["repetitions"] = 9
        (self.dir / "metadata.public.json").write_text(json.dumps(metadata), encoding="utf-8")
        self.expect("repetición 10 fuera de 1..9")
        metadata["repetitions"], metadata["status"] = 10, "running"
        (self.dir / "metadata.public.json").write_text(json.dumps(metadata), encoding="utf-8")
        self.expect("no está marcada como válida")

    def test_missing_file_and_hash_mismatch_in_snapshot(self):
        (self.dir / "errors.csv").unlink()
        self.expect("Faltan artefactos")
        snapshot = self.dir / "snap"
        shutil.copytree(SNAPSHOT, snapshot)
        with (snapshot / "summary.csv").open("a", encoding="utf-8") as stream:
            stream.write("\n")
        with self.assertRaises(EvidenceError) as caught:
            load_snapshot(snapshot)
        self.assertIn("hash publicado", str(caught.exception))
        shutil.copy(SNAPSHOT / "summary.csv", snapshot / "summary.csv")
        (snapshot / "extra.csv").write_text("x\n", encoding="utf-8")
        with self.assertRaises(EvidenceError) as caught:
            load_snapshot(snapshot)
        self.assertIn("no autorizados", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
