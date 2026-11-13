import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

from etl_dsl.api import compile_source, run_source, strip_comments
from scripts.create_demo_data import create_demo_data


ROOT = Path(__file__).resolve().parents[1]
VALID = """PIPELINE p {
    FROM CSV(file: "v.csv") AS TABLE[id: INT, x: DECIMAL?];
    STEP f = FILTER { WHERE x > 1; }
    STEP g = FILTER { WHERE id > 0; }
    TO CSV(file: "out/s.csv");
}"""


def codes(result):
    return [(d["code"], d["stage"]) for d in result["diagnostics"]]


class CompileSourceTests(unittest.TestCase):
    def test_valid_program_has_every_stage(self):
        result = compile_source(VALID)
        self.assertTrue(result["ok"])
        self.assertEqual(result["diagnostics"], [])
        self.assertEqual(result["ast"]["node"], "Program")
        self.assertIn("def pipeline_0", result["code"])
        before, after = result["ir"]["before"], result["ir"]["after"]
        self.assertEqual(len(before["pipelines"][0]["nodes"]), 4)
        fused = [n for n in after["pipelines"][0]["nodes"] if len(n["origin"]) > 1]
        self.assertEqual(fused[0]["origin"], ["f", "g"])
        self.assertEqual(fused[0]["schema"], "[id: INT, x: DECIMAL?]")
        self.assertEqual(after["pipelines"][0]["edges"][0],
                         {"from": "origen", "from_port": None, "to": "g", "to_port": None})
        self.assertEqual(fused[0]["start"]["line"], 3)
        json.dumps(result)  # todo debe ser serializable

    def test_code_is_shown_without_comments(self):
        code = compile_source(VALID)["code"]
        self.assertNotIn("# ", code)
        compile(code, "programa.py", "exec")

    def test_strip_comments_keeps_hashes_inside_strings(self):
        code = "# cabecera\nx = '#no'  # nota\n    # sangrado\ny = 1\n"
        self.assertEqual(strip_comments(code), "x = '#no'\ny = 1\n")

    def test_errors_keep_previous_stages(self):
        result = compile_source("PIPELINE p { FROM CSV(file: \"a\") # ; }")
        self.assertEqual(codes(result), [("E_LEXICAL", "lexical")])
        self.assertIsNone(result["ast"])
        result = compile_source("PIPELINE p { FROM CSV(file: \"a\"); FILTRO { } }")
        self.assertEqual(codes(result), [("E_SYNTAX", "syntax")])
        result = compile_source(VALID.replace('TO CSV(file: "out/s.csv");', ""))
        self.assertEqual(codes(result), [("E_LINEAR_END", "structure")])
        self.assertIsNotNone(result["ast"])
        self.assertIsNone(result["ir"]["before"])
        result = compile_source(VALID.replace("x > 1", "x > \"1\""))
        self.assertEqual(codes(result), [("E_TYPE", "types")])
        self.assertIsNotNone(result["ir"]["before"])
        self.assertIsNone(result["ir"]["after"])
        result = compile_source(VALID.replace('CSV(file: "v.csv")', 'CSV(file: "v.csv", header: "yes")'))
        self.assertEqual(codes(result), [("E_CONNECTOR", "codegen")])
        self.assertEqual(result["diagnostics"][0]["start"]["line"], 2)

    def test_passes(self):
        nodes = compile_source(VALID, [])["ir"]["after"]["pipelines"][0]["nodes"]
        self.assertEqual([n["id"] for n in nodes], ["origen", "f", "g", "destino"])
        with self.assertRaises(ValueError):
            compile_source(VALID, ["magia"])


class RunSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.temp)
        (self.temp / "data").mkdir()
        (self.temp / "data" / "v.csv").write_text("id,x\n1,5.5\n2,\n3,0.5\n-1,9\n", encoding="utf-8")

    def run_program(self, source):
        return run_source(source, base_dir=self.temp / "data", root=self.temp, limit=1)

    def test_results_are_limited_and_serializable(self):
        result = self.run_program(VALID)
        self.assertTrue(result["ok"], result["diagnostics"])
        table = result["results"]["p"]["destino"]
        self.assertEqual([c["name"] for c in table["columns"]], ["id", "x"])
        self.assertEqual(table["rows"], [[1, 5.5]])
        self.assertEqual(table["total_rows"], 1)
        self.assertTrue((self.temp / "data" / "out" / "s.csv").is_file())
        json.dumps(result)

    def test_runtime_errors_are_located(self):
        result = self.run_program(VALID.replace('"v.csv"', '"missing.csv"'))
        self.assertFalse(result["ok"])
        error = result["diagnostics"][0]
        self.assertEqual((error["code"], error["stage"], error["start"]["line"]), ("E_SOURCE", "runtime", 2))
        self.assertIsNone(result["results"])

    def test_paths_outside_root_are_rejected(self):
        result = self.run_program(VALID.replace('"out/s.csv"', '"../../fuera.csv"'))
        self.assertEqual(result["diagnostics"][0]["code"], "E_PATH")
        self.assertFalse((self.temp.parent / "fuera.csv").exists())


@unittest.skipUnless(importlib.util.find_spec("fastapi") and importlib.util.find_spec("httpx"),
                     "requiere fastapi y httpx")
class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        from etl_dsl.web import create_app

        cls.temp = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "input", cls.temp / "input", ignore=shutil.ignore_patterns("out"))
        shutil.copytree(ROOT / "demo", cls.temp / "demo")
        create_demo_data(cls.temp / "input")
        cls.client = TestClient(create_app(cls.temp / "input", [cls.temp / "input", cls.temp / "demo"]))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp)

    def test_examples(self):
        names = self.client.get("/api/examples").json()
        self.assertIn("input/duckdb.etl", names)
        self.assertIn("demo/tipos.etl", names)
        example = self.client.get("/api/examples/input/duckdb.etl").json()
        self.assertIn("PIPELINE ventas_por_cliente", example["source"])
        self.assertEqual(self.client.get("/api/examples/../pyproject.toml").status_code, 404)

    def test_programs_cannot_write_outside_data_dir(self):
        source = 'PIPELINE p { FROM CSV(file: "orders.csv"); TO CSV(file: "../README.md"); }'
        result = self.client.post("/api/run", json={"source": source}).json()
        self.assertEqual(result["diagnostics"][0]["code"], "E_PATH")

    def test_demo_programs_run(self):
        source = (self.temp / "demo" / "optimizaciones.etl").read_text(encoding="utf-8")
        result = self.client.post("/api/run", json={"source": source}).json()
        self.assertTrue(result["ok"], result["diagnostics"])

    def test_compile_and_run(self):
        source = (self.temp / "input" / "duckdb.etl").read_text(encoding="utf-8")
        compiled = self.client.post("/api/compile", json={"source": source}).json()
        self.assertTrue(compiled["ok"])
        ran = self.client.post("/api/run", json={"source": source, "passes": []}).json()
        self.assertTrue(ran["ok"], ran["diagnostics"])
        self.assertEqual(ran["passes"], [])
        self.assertEqual(ran["results"]["ventas_por_cliente"]["destino"]["rows"],
                         [[1, "150.00", 2], [2, "25.00", 1]])

    def test_invalid_requests(self):
        self.assertEqual(self.client.post("/api/compile", json={"source": "x", "passes": ["magia"]}).status_code, 422)
        self.assertEqual(self.client.post("/api/compile", json={"source": "x" * 200_001}).status_code, 422)
        self.assertEqual(self.client.post("/api/compile", json={}).status_code, 422)

    def test_page_is_served(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Entorno DSL ETL", page.text)
        self.assertEqual(self.client.get("/app.js").status_code, 200)


if __name__ == "__main__":
    unittest.main()
