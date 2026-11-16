import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import benchmark as b


class BenchmarkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tasks = b.load_tasks()
        cls.demo = [json.loads(line) for line in (HERE / "ejemplos/respuestas_demo.jsonl").read_text(encoding="utf-8").splitlines()]

    def test_archive_and_coverage(self):
        self.assertEqual(len(b.verify_upstream()["sha256"]), 83)
        self.assertEqual(len(self.tasks), 80)
        self.assertEqual(len(set(self.tasks) - b.UNSUPPORTED.keys()), 60)

    def test_empty_expected_and_strict_output_comparison(self):
        self.assertEqual(b.expected({"expected": [], "expected_output": None}), [])
        self.assertTrue(b.compare([], []))
        self.assertFalse(b.compare(None, []))
        self.assertFalse(b.compare([{"x": 1, "extra": 2}], [{"x": 1}]))
        self.assertFalse(b.compare([{"x": 2}, {"x": 1}], [{"x": 1}, {"x": 2}]))
        self.assertFalse(b.compare(True, 1))
        self.assertFalse(b.compare(math.nan, 1))
        self.assertTrue(b.compare(1.0000000001, 1))

    def test_prompt_does_not_include_test_inputs_or_expected(self):
        text = b.prompt(self.tasks["multi_001"], "capybara")
        self.assertIn("input/orders.parquet", text)
        self.assertNotIn("Alice", text)
        self.assertNotIn("expected", text)
        self.assertNotIn("{schema}", text)

    def test_export_contains_only_prompts_of_one_language(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            b.prepare(root / "prepared", ids=["multi_001"])
            # Un campo extra del origen nunca debe llegar al paquete público.
            path = root / "prepared" / "prompts.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            rows[0]["expected_output"] = "PRIVATE_CANARY"
            path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
            b.export_generation(root / "prepared", root / "generation.zip", "capybara")
            with zipfile.ZipFile(root / "generation.zip") as archive:
                self.assertEqual(set(archive.namelist()), {"LEEME.md", "solicitudes.jsonl"})
                payload = archive.read("solicitudes.jsonl").decode("utf-8")
                self.assertNotIn("PRIVATE_CANARY", payload)
                exported = [json.loads(line) for line in payload.splitlines()]
                self.assertEqual(len(exported), 1)
                self.assertEqual(exported[0]["language"], "capybara")
                self.assertEqual(set(exported[0]), {"task_id", "language", "prompt", "prompt_sha256"})
                self.assertNotIn("Alice", payload)

    def test_export_rejects_modified_prompts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            row = {"task_id": "x", "language": "capybara", "prompt": "changed", "prompt_sha256": "bad"}
            (root / "prompts.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "modificado"):
                b.export_generation(root, root / "generation.zip", "capybara")

    def test_demo_passes_both_languages(self):
        for row in self.demo:
            with self.subTest(language=row["language"]):
                value = b.execute(self.tasks[row["task_id"]], row["code"], row["language"])
                self.assertEqual(value["status"], "passed", value)
                self.assertTrue(value["syntax_ok"])

    def test_empty_and_null_inputs_are_materialized_with_schema(self):
        task = {"input_schema": {"orders": {"columns": ["id", "customer", "amount", "status"],
                                               "types": ["INT", "STRING", "DECIMAL", "STRING"]}},
                "test_cases": [{"input": {"orders": []}, "expected": []},
                               {"input": {"orders": [{"id": 1, "customer": None, "amount": None, "status": None}]}, "expected": []}]}
        value = b.execute(task, self.demo[0]["code"], "capybara")
        self.assertEqual(value["status"], "passed", value)

    def test_two_sources_join_and_derived_column(self):
        code = '''PIPELINE task {
 SOURCE products: TABLE[product_id: INT?, name: STRING?, category: STRING?]
   = PARQUET(file: "input/products.parquet");
 SOURCE stock: TABLE[product_id: INT?, quantity: INT?, avg_daily_sales: DECIMAL?]
   = PARQUET(file: "input/inventory.parquet");
 STEP renamed = RENAME { product_id AS stock_id; }
 STEP combined = JOIN { TYPE INNER; ON left.product_id == right.stock_id; }
 STEP computed = DERIVE { days_of_stock = quantity / avg_daily_sales; }
 STEP urgent = FILTER { WHERE days_of_stock < 30; }
 STEP ordered = SORT { BY days_of_stock ASC; }
 STEP chosen = SELECT { COLUMNS product_id, name, category, quantity, avg_daily_sales, days_of_stock; }
 SINK result = PARQUET(file: "output.parquet");
 FLOW { products -> combined.left; stock -> renamed -> combined.right;
        combined -> computed -> urgent -> ordered -> chosen -> result; }
}'''
        result = b.execute(self.tasks["hard_004"], code, "capybara")
        self.assertEqual(result["status"], "passed", result)

    def test_syntax_error_and_wrong_output_are_distinct(self):
        invalid = b.execute(self.tasks["multi_001"], "PIPELINE {", "capybara")
        self.assertEqual(invalid["status"], "compile_error", invalid)
        self.assertFalse(invalid["syntax_ok"])
        wrong = b.execute(self.tasks["multi_001"], "def transform(data): return []", "python")
        self.assertEqual(wrong["status"], "wrong_output", wrong)

    def test_timeout(self):
        result = b.execute(self.tasks["multi_001"], "while True: pass", "python", timeout=.3)
        self.assertEqual(result["status"], "timeout", result)

    def test_duplicate_answers_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            b.dump(root / "manifest.json", {"upstream_commit": b.verify_upstream()["commit"], "selected": [{"task_id": "multi_001"}]})
            (root / "responses.jsonl").write_text((json.dumps(self.demo[0]) + "\n") * 2, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicada"):
                b.evaluate(root / "responses.jsonl", root / "results.json", root / "manifest.json", 1)


if __name__ == "__main__":
    unittest.main()
