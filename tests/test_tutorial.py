"""El tutorial publicado se comprueba ejecutándolo: programa, fragmentos, comandos, salidas y dataset.

docs/tutorial.md no se escribe a mano a partir de suposiciones: cada bloque `sh` debe ser un
comando que esta prueba ejecuta, cada bloque `output`/`csv` debe coincidir con lo que produce y
cada fragmento `text` debe ser parte literal de demo/tutorial.etl (o su error documentado).
"""
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import replace
from io import StringIO
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from etl_dsl import analyze, parse
from etl_dsl import ast as a
from etl_dsl.main import main
from web.scripts.gen_content import build_content, ROOT

DOC = ROOT / "docs/tutorial.md"
PROGRAM = ROOT / "demo/tutorial.etl"
DATASET = ROOT / "demo/joins_pedidos.csv"
TYPO = ("WHERE importe > 0;", "WHERE importes > 0;")
# Comandos del tutorial, en el orden en que se ejecutan aquí.
CHECK = "python main.py demo/tutorial.etl --format check"
RUN = "python main.py demo/tutorial.etl --run"
SCRIPT = "python output/tutorial.py"


def blocks(text):
    """(lenguaje, contenido sin el salto final) de cada bloque cercado."""
    return [(m[1], m[2].removesuffix("\n")) for m in re.finditer(r"^```(\w*)\n(.*?)^```", text, re.M | re.S)]


def tutorial_entries():
    content = build_content()
    example = next(e for e in content["examples"] if e["source"] == "demo/tutorial.etl")
    article = next(x for x in content["articles"] if x["slug"] == "tutorial")
    return example, article


class TutorialTests(unittest.TestCase):
    def setUp(self):
        self.doc = DOC.read_text(encoding="utf-8")
        self.source = PROGRAM.read_text(encoding="utf-8")

    def test_program_compiles_and_is_published_with_its_expectations(self):
        example, article = tutorial_entries()
        self.assertEqual(article["program"], example["slug"])
        self.assertIn("tutorial", example["docs"])
        self.assertEqual(example["code"], self.source)
        for passes in (None, []):
            result = analyze(self.source, filename=example["name"], passes=passes).to_dict()
            self.assertTrue(result["ok"], result["diagnostics"])
            self.assertEqual(result["pipeline_count"], example["expectation"]["pipelines"])
        # El tutorial afirma que la IR es igual antes y después de los pases predeterminados.
        result = analyze(self.source, filename="tutorial.etl").to_dict()["artifacts"]
        self.assertEqual(result["ir_before"]["data"]["text"], result["ir_after"]["data"]["text"])
        self.assertEqual(set(example["operations"]), {"FILTER", "DERIVE", "AGGREGATE", "SORT"})
        # La entrada de «Tu primer programa» enlaza el tutorial.
        self.assertIn("(/docs/tutorial)", (ROOT / "docs/guia_estudio.md").read_text(encoding="utf-8"))

    def test_declared_dataset_is_the_included_csv_of_the_source(self):
        example, _ = tutorial_entries()
        [declared] = example["datasets"]
        program = parse(self.source)
        [pipeline] = program.pipelines
        source = next(d for d in pipeline.declarations
                      if isinstance(d, a.Source) and d.name == declared["declaration"])
        self.assertEqual(pipeline.name, declared["pipeline"])
        options = {arg.name: arg.value.value for arg in source.connector.arguments}
        self.assertEqual(source.connector.name, "CSV")
        self.assertEqual(PROGRAM.parent / options["file"], DATASET)
        try:
            from service.catalog import ENTRIES
        except ImportError as exc:  # pragma: no cover - sin dependencias del servicio
            self.skipTest(f"Servicio no instalado: {exc}")
        entry = next(e for e in ENTRIES if e.id == declared["dataset"] and e.version == declared["version"])
        self.assertTrue(entry.included, "El tutorial promete un dataset sin preparación")
        self.assertEqual((entry.driver, entry.file), ("CSV", DATASET.name))
        self.assertIn(f"{declared['pipeline']}.{declared['declaration']} → {entry.id}@{entry.version}",
                      " ".join(example["requirements"]))
        self.assertIn(("csv", DATASET.read_text(encoding="utf-8").removesuffix("\n")), blocks(self.doc))

    def test_fragments_are_literal_parts_of_the_canonical_program(self):
        fragments = [body for lang, body in blocks(self.doc) if lang == "text"]
        self.assertGreaterEqual(len(fragments), 6)
        self.assertEqual(self.source.count(TYPO[0]), 1)
        typo_line = next(line for line in self.source.splitlines() if TYPO[0] in line).replace(*TYPO)
        for fragment in fragments:
            with self.subTest(fragment=fragment):
                self.assertTrue(fragment in self.source or fragment == typo_line)

    def test_commands_and_outputs_are_the_real_ones(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            (root / "demo").mkdir()
            shutil.copyfile(PROGRAM, root / "demo/tutorial.etl")
            shutil.copyfile(DATASET, root / "demo/joins_pedidos.csv")

            def cli(command):
                out, err = StringIO(), StringIO()
                previous = Path.cwd()
                try:
                    os.chdir(root)
                    with redirect_stdout(out), redirect_stderr(err):
                        code = main(command.split()[2:])
                finally:
                    os.chdir(previous)
                return code, out.getvalue(), err.getvalue()

            def shown(text):
                return text.replace(f"{root}/", "…/").removesuffix("\n")

            produced = {}
            code, out, _ = cli(CHECK)
            self.assertEqual(code, 0)
            produced["check"] = shown(out)
            program = root / "demo/tutorial.etl"
            program.write_text(self.source.replace(*TYPO), encoding="utf-8")
            code, _, err = cli(CHECK)
            self.assertEqual(code, 1)
            produced["error"] = shown(err)
            self.assertTrue(err.startswith("demo/tutorial.etl:10:15: E_COLUMN"))
            self.assertIn("línea 10, columna 15", self.doc)
            program.write_text(self.source, encoding="utf-8")
            code, out, _ = cli(RUN)
            self.assertEqual(code, 0)
            produced["run"] = shown(out)
            result = root / "demo/out/gasto_por_cliente.csv"
            produced["csv"] = result.read_text(encoding="utf-8").removesuffix("\n")
            result.unlink()
            script = subprocess.run([sys.executable, *SCRIPT.split()[1:]], cwd=root,
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(script.returncode, 0, script.stderr)
            produced["script"] = shown(script.stdout)
            self.assertEqual(result.read_text(encoding="utf-8").removesuffix("\n"), produced["csv"])

        documented = blocks(self.doc)
        commands = [body for lang, body in documented if lang == "sh"]
        self.assertEqual(set(commands), {CHECK, RUN, SCRIPT})
        outputs = [body for lang, body in documented if lang == "output"]
        self.assertEqual(outputs, [produced["error"], produced["check"], produced["run"], produced["script"]])
        self.assertEqual([body for lang, body in documented if lang == "csv"][-1], produced["csv"])

    def test_private_service_runs_the_tutorial_without_preparation(self):
        try:
            from fastapi.testclient import TestClient
            from service.app import create_app
            from service.config import Settings
        except ImportError as exc:  # pragma: no cover - sin dependencias del servicio
            self.skipTest(f"Servicio no instalado: {exc}")
        example, _ = tutorial_entries()
        [declared] = example["datasets"]
        expected = [body for lang, body in blocks(self.doc) if lang == "csv"][-1] + "\n"
        with tempfile.TemporaryDirectory() as storage, tempfile.TemporaryDirectory() as empty:
            # Directorio de datasets vacío: equivale a no haber ejecutado service.prepare.
            settings = replace(Settings(), storage=Path(storage), datasets=Path(empty))
            with TestClient(create_app(settings)) as client:
                body = dict(source=self.source, filename=example["name"], document_id="tutorial", revision=1,
                            pipeline=declared["pipeline"], passes=None,
                            bindings=[dict(pipeline=declared["pipeline"], declaration=declared["declaration"],
                                           dataset_id=declared["dataset"], version=declared["version"])])
                response = client.post("/api/v1/runs", json=body)
                self.assertEqual(response.status_code, 202, response.text)
                run = response.json()
                until = time.monotonic() + 30
                while run["state"] in ("queued", "running") and time.monotonic() < until:
                    time.sleep(.05)
                    run = client.get(run["status_url"]).json()
                self.assertEqual(run["state"], "succeeded", run)
                [artifact] = run["artifacts"]
                self.assertEqual(artifact["name"], "gasto_por_cliente.csv")
                self.assertIn(f"Descargar {artifact['name']}", self.doc)
                preview = client.get(f"{run['status_url']}/outputs/{run['outputs'][0]['id']}/preview").json()
                self.assertEqual(preview["rows"], [[2, 2, 70, "82.60"], [1, 1, 10, "11.80"]])
                downloaded = client.get(f"{run['status_url']}/artifacts/{artifact['id']}").content
                self.assertEqual(downloaded.decode("utf-8"), expected)


if __name__ == "__main__":
    unittest.main()
