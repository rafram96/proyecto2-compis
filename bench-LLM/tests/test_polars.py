import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import benchmark as b

PROGRAM = '''import polars as pl
def transform(data):
    return data["orders"].filter(pl.col("amount") > 100).select("id", "customer")
'''


class PolarsBenchmarkTests(unittest.TestCase):
    def test_polars_dataframe_and_lazyframe_outputs(self):
        task = b.load_tasks()['multi_001']
        for code in [PROGRAM, PROGRAM.replace('data["orders"].filter', 'data["orders"].lazy().filter')]:
            result = b.execute(task, code, 'polars')
            self.assertEqual(result['status'], 'passed', result)

    def test_polars_does_not_accept_pure_python_contract(self):
        task = b.load_tasks()['multi_001']
        for code in ['def transform(data): return []', 'import polars as pl\ndef transform(data): return []']:
            result = b.execute(task, code, 'polars')
            self.assertEqual(result['status'], 'contract_error', result)

    def test_polars_empty_and_null_inputs_keep_types(self):
        task = b.load_tasks()['multi_001']
        task['test_cases'] = [{'input': {'orders': []}, 'expected': []},
                              {'input': {'orders': [{'id': 1, 'customer': None, 'amount': None, 'status': None}]}, 'expected': []}]
        result = b.execute(task, PROGRAM, 'polars')
        self.assertEqual(result['status'], 'passed', result)

    def test_prepared_manifest_identifies_new_and_legacy_baselines(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for baseline in ['polars', 'python']:
                manifest = b.prepare(root/baseline, ids=['multi_001'], baseline=baseline)
                self.assertEqual(manifest['languages'], ['capybara', baseline])
                rows = [json.loads(line) for line in (root/baseline/'prompts.jsonl').read_text(encoding='utf-8').splitlines()]
                self.assertEqual({row['language'] for row in rows}, {'capybara', baseline})
            prompt = b.prompt(b.load_tasks()['multi_001'], 'polars')
            self.assertIn('import polars as pl', prompt)
            self.assertNotIn('Use only the Python standard library.', prompt)


if __name__ == '__main__':
    unittest.main()
