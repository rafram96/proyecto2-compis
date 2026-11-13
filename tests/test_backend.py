from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import polars as pl

from etl_dsl import CompileError, compile_program, parse, parse_file
from etl_dsl.main import main
from etl_dsl.runtime import ExecutionError, PolarsRuntime, run_pipelines
from scripts.create_demo_data import create_demo_data


ROOT = Path(__file__).resolve().parents[1]
DATA = {"id": pl.Int64, "x": pl.Float64, "s": pl.String}


def generated(source, base_dir="."):
    code = compile_program(parse(source), base_dir=base_dir)
    namespace = {"__name__": "test_generated"}
    exec(compile(code, "generated.py", "exec"), namespace)
    return namespace


def single(operation, schema="id: INT, x: DECIMAL?, s: STRING?"):
    return f"""PIPELINE p {{ FROM INPUT data: TABLE[{schema}];
    {operation}
    TO OUTPUT result: TABLE; }}"""


def frame(rows, schema=None):
    return pl.DataFrame(rows, schema=schema or DATA, orient="row").lazy()


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.rt = PolarsRuntime()

    def rows(self, table, order=None):
        result = table.collect()
        return (result.sort(order) if order else result).rows()

    def evaluate(self, source, data):
        module = generated(source)
        return module["PIPELINES"]["p"](self.rt, {"data": data})["result"]

    def test_filter_null_logic_math_and_scalar_functions(self):
        source = '''PIPELINE p { FROM INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?];
 FILTER { WHERE NOT id < 0 AND (x IS NULL OR x >= 0); }
 DERIVE { ratio = SAFE_DIVIDE(x, id); cleaned = LOWER(TRIM(COALESCE(s, "NA")));
     z = NULLIF(id, 0); flag = x IS NULL; calc = (id + 2) * 3 - 1; }
 TO OUTPUT result: TABLE; }'''
        table = self.evaluate(source, frame([(0, 5.0, ' A '), (2, 6.0, None), (3, None, ''), (-1, 1.0, 'b')]))
        rows = self.rows(table, 'id')
        self.assertEqual([(r[0], *r[3:]) for r in rows],
                         [(0, None, 'a', None, False, 5), (2, 3.0, 'na', 2, False, 11), (3, None, '', 3, True, 14)])
        filtered = self.evaluate(single('FILTER { WHERE x > 0; }'),
                                 frame([(1, None, None), (2, 0.0, ''), (3, 4.0, 'ok')]))
        self.assertEqual([r[0] for r in self.rows(filtered)], [3])

    def test_drop_fill_rename_distinct_select_and_sort(self):
        source = '''PIPELINE p { FROM INPUT data: TABLE[id: INT?, x: DECIMAL?, s: STRING?];
 DROP_NULLS { COLUMNS id; }
 FILL_NULL { x = 7; s = UPPER(COALESCE(s, "unknown")); }
 RENAME { id AS key; }
 DISTINCT { COLUMNS key, x, s; }
 SORT { BY key DESC; }
 SELECT { COLUMNS key, x; }
 TO OUTPUT result: TABLE; }'''
        table = self.evaluate(source, frame([(None, 1, None), (1, None, None), (2, 0, ''), (2, 0, '')],
                                            {"id": pl.Int64, "x": pl.Int64, "s": pl.String}))
        self.assertEqual(self.rt.columns(table), ('key', 'x'))
        self.assertEqual(self.rows(table), [(2, 0), (1, 7)])
        # FILL_NULL conserva los valores no nulos y usa solo la entrada original.
        table = self.evaluate(single('FILL_NULL { x = id; s = "fallback"; }'), frame([(1, 0.0, '')]))
        self.assertEqual(self.rows(table), [(1, 0, '')])

    def test_aggregate_count_nulls_and_empty_input(self):
        op = 'AGGREGATE { COUNT() AS n; COUNT(x) AS nx; SUM(x) AS total; AVG(x) AS average; MIN(x) AS lo; MAX(x) AS hi; }'
        ints = {"id": pl.Int64, "x": pl.Int64, "s": pl.String}
        table = self.evaluate(single(op), frame([(1, 5, None), (2, None, None), (3, 7, None)], ints))
        self.assertEqual(self.rows(table)[0], (3, 2, 12, 6.0, 5, 7))
        table = self.evaluate(single(op), frame([], ints))
        self.assertEqual(self.rows(table), [(0, 0, None, None, None, None)])

    def test_group_by(self):
        table = self.evaluate(single('AGGREGATE { GROUP_BY s; COUNT() AS n; SUM(x) AS total; }'),
                              frame([(1, 2, 'a'), (2, 3, 'a'), (3, None, 'b')],
                                    {"id": pl.Int64, "x": pl.Int64, "s": pl.String}))
        self.assertEqual(self.rows(table, 's'), [('a', 2, 5), ('b', 1, None)])

    def test_join_types_multiple_conditions_and_null_keys(self):
        for kind, count in [('INNER', 1), ('LEFT', 3), ('RIGHT', 3), ('FULL', 5)]:
            source = f'''PIPELINE p {{
 INPUT a: TABLE[id: INT?, a: INT]; INPUT b: TABLE[key: INT?, b: INT];
 STEP j = JOIN {{ TYPE {kind}; ON left.id == right.key AND right.b == left.a; }}
 OUTPUT o: TABLE; FLOW {{ a -> j.left; b -> j.right; j -> o; }} }}'''
            module = generated(source)
            left = frame([(1, 7), (2, 8), (None, 9)], {"id": pl.Int64, "a": pl.Int64})
            right = frame([(1, 7), (3, 8), (None, 9)], {"key": pl.Int64, "b": pl.Int64})
            table = module['PIPELINES']['p'](self.rt, {'a': left, 'b': right})['o']
            with self.subTest(kind=kind):
                self.assertEqual(len(self.rows(table)), count)
                self.assertEqual(self.rt.columns(table), ('id', 'a', 'key', 'b'))

    def test_use_multiple_instances_forward_definition_and_fanout(self):
        source = '''PIPELINE p { INPUT data: TABLE[id: INT]; USE clean AS a; USE clean AS b;
 OUTPUT result: TABLE; OUTPUT other: TABLE;
 FLOW { data -> a.i; data -> b.i; a.o -> result; b.o -> other; } }
 PIPELINE clean { FROM INPUT i: TABLE[id: INT]; DERIVE { y = id * 2; }
 TO OUTPUT o: TABLE[id: INT, y: INT]; }'''
        module = generated(source)
        data = frame([(3,)], {"id": pl.Int64})
        results = module['PIPELINES']['p'](self.rt, {'data': data})
        self.assertEqual(self.rows(results['result']), [(3, 6)])
        self.assertEqual(self.rows(results['other']), [(3, 6)])
        self.assertEqual(self.rows(data), [(3,)])
        self.assertEqual(module['DEFAULT_PIPELINES'], [])

    def test_input_binding_and_root_selection(self):
        module = generated(single('FILTER { WHERE id > 0; }'))
        with self.assertRaisesRegex(ExecutionError, 'No hay pipelines'):
            run_pipelines(self.rt, module['PIPELINES'], module['DEFAULT_PIPELINES'])
        with self.assertRaisesRegex(ExecutionError, 'falta enlazar INPUT'):
            run_pipelines(self.rt, module['PIPELINES'], [], ['p'])
        with self.assertRaisesRegex(ExecutionError, 'desconocido'):
            run_pipelines(self.rt, module['PIPELINES'], [], ['missing'])

    def test_column_errors_and_assignment_scope(self):
        # Con INPUT tipado se detectan al compilar; sin esquema conocido, al ejecutar.
        for op in ['DERIVE { id = 0; }', 'DERIVE { a = 1; b = a + 1; }',
                   'FILL_NULL { missing = 0; }', 'SELECT { COLUMNS ID; }',
                   'RENAME { id AS x; }', 'RENAME { missing AS new; }',
                   'DERIVE { ID = 1; }', 'DERIVE { bad = s + 1; }']:
            with self.subTest(op=op):
                with self.assertRaises(CompileError):
                    generated(single(op))
                untyped = single(op).replace('INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?]',
                                             'CSV(file: "data.csv")')
                module = generated(untyped)
                with tempfile.TemporaryDirectory() as temp, PolarsRuntime(temp) as rt:
                    pl.DataFrame({"id": [1], "x": [2.0], "s": ["a"]}).write_csv(Path(temp) / "data.csv")
                    with self.assertRaises(ExecutionError):
                        module["PIPELINES"]["p"](rt)["result"].collect()

    def test_join_ambiguous_columns_rejected(self):
        source = '''PIPELINE p { INPUT a: TABLE[id: INT]; INPUT b: TABLE[id: INT];
 STEP j = JOIN { TYPE INNER; ON left.id == right.id; }
 OUTPUT o: TABLE; FLOW { a -> j.left; b -> j.right; j -> o; } }'''
        with self.assertRaisesRegex(CompileError, 'E_AMBIGUOUS_COLUMNS'):
            generated(source)
        # Sin esquemas conocidos lo detecta el runtime.
        table = frame([(1,)], {"id": pl.Int64})
        with self.assertRaisesRegex(ExecutionError, 'E_AMBIGUOUS_COLUMNS'):
            self.rt.disjoint(table, table, 'test')

    def test_contracts_and_case_sensitive_columns(self):
        for data, schema, code in [
            (frame([(None,)], {"id": pl.Int64}), [('id', 'INT', False)], 'E_NULL'),
            (frame([('text',)], {"id": pl.String}), [('id', 'INT', False)], 'E_TYPE'),
            (frame([(1,)], {"ID": pl.Int64}), [('id', 'INT', False)], 'E_SCHEMA'),
            (frame([(1, 2)], {"id": pl.Int64, "x": pl.Int64}), [('id', 'INT', False)], 'E_SCHEMA'),
        ]:
            with self.subTest(code=code), self.assertRaisesRegex(ExecutionError, code):
                self.rt.contract(data, schema, 'test')

    def test_escaping_and_python_keyword_names(self):
        text = "O'Reilly \\ {text}\nline"
        source = single(f'DERIVE {{ text = {json.dumps(text)}; }}')
        result = self.evaluate(source, frame([(1, 2.0, '')]))
        self.assertEqual(self.rows(result)[0][-1], text)
        source = single('FILTER { WHERE id > 0; }').replace('PIPELINE p', 'PIPELINE class')
        self.assertIn('class', generated(source)['PIPELINES'])

    def test_decimal_literals_keep_precision(self):
        table = self.evaluate(single('DERIVE { y = 0.1 + 0.2; }'), frame([(1, 2.0, '')]))
        self.assertEqual(self.rows(table)[0][-1], Decimal('0.3'))

    def test_connector_errors_are_compile_time_and_no_source_io(self):
        source = 'PIPELINE p { FROM CSV(file: "does-not-exist.csv"); TO OUTPUT o: TABLE; }'
        compile_program(parse(source))
        for connector in ['UNKNOWN(file: "x")', 'CSV()', 'CSV(file: 2)',
                          'CSV(file: "x", header: "yes")', 'CSV(file: "x", delimiter: "::")',
                          'PARQUET(file: "x", table: "t")', 'DUCKDB(file: "x")']:
            with self.subTest(connector=connector), self.assertRaises(CompileError):
                compile_program(parse(source.replace('CSV(file: "does-not-exist.csv")', connector)))


class ConnectorTests(unittest.TestCase):
    def test_csv_preserves_null_empty_string_zero_and_options(self):
        with tempfile.TemporaryDirectory() as temp, PolarsRuntime(temp) as rt:
            table = frame([(0, ''), (1, None), (2, 'NA')], {"id": pl.Int64, "s": pl.String})
            for options in [{'file': 'a.csv'}, {'file': 'b.csv', 'delimiter': ';', 'nullstr': 'NULL'}]:
                rt.sink(table, 'CSV', options, 'test')
                loaded = rt.source('CSV', options, None, 'test')
                self.assertEqual(loaded.collect().sort('id').rows(), [(0, ''), (1, None), (2, 'NA')])

    def test_original_examples_execute(self):
        with tempfile.TemporaryDirectory() as temp:
            create_demo_data(temp)
            for path in ('credit_risk.etl', 'duckdb.etl'):
                namespace = {'__name__': 'test_generated'}
                code = compile_program(parse_file(ROOT / 'input' / path), base_dir=temp)
                exec(compile(code, path + '.py', 'exec'), namespace)
                with PolarsRuntime(temp) as rt:
                    results = run_pipelines(rt, namespace['PIPELINES'], namespace['DEFAULT_PIPELINES'])
                    self.assertNotIn('clean_orders', results)
            rows = pl.read_parquet(Path(temp) / 'out/ventas_por_cliente.parquet').rows()
            self.assertEqual(rows, [(1, Decimal('150.00'), 2), (2, Decimal('25.00'), 1)])
            rows = pl.read_parquet(Path(temp) / 'summary.parquet').sort('segment_label').rows()
            self.assertEqual(rows, [('A', 1, 1, 0.2), ('UNKNOWN', 1, 1, 0.0)])
            rows = pl.read_csv(Path(temp) / 'orders_clean.csv').sort('customer_id').rows()
            self.assertEqual(rows, [(1, 10.5, 'paid'), (2, 0.0, 'UNKNOWN'), (9, 30.0, 'pending')])

    def test_csv_parquet_and_native_duckdb_sink_modes(self):
        with tempfile.TemporaryDirectory() as temp, PolarsRuntime(temp) as rt:
            table = frame([(3, 'a')], {"id": pl.Int64, "s": pl.String})
            for driver, file in [('CSV', 'nested/a.csv'), ('PARQUET', 'nested/a.parquet')]:
                options = {'file': file}
                rt.sink(table, driver, options, 'test')
                # La misma salida puede regenerarse.
                rt.sink(table, driver, options, 'test')
                loaded = rt.source(driver, options, None, 'test')
                self.assertEqual(loaded.collect().rows(), [(3, 'a')])
            options = {'file': 'out.duckdb', 'table': 'select', 'schema': 'report'}
            rt.sink(table, 'DUCKDB', options, 'test')
            with self.assertRaises(ExecutionError):
                rt.sink(table, 'DUCKDB', options, 'test')
            rt.sink(table, 'DUCKDB', {**options, 'mode': 'replace'}, 'test')
            rt.sink(table, 'DUCKDB', {**options, 'mode': 'append'}, 'test')
            loaded = rt.source('DUCKDB', {k: v for k, v in options.items() if k != 'mode'}, None, 'test')
            self.assertEqual(loaded.collect().height, 2)

    def test_cli_compile_run_and_generated_script(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            create_demo_data(root)
            # El nombre polars.py no debe ocultar la biblioteca del motor.
            source = root / 'polars.etl'
            source.write_text((ROOT / 'input/duckdb.etl').read_text(encoding='utf-8'), encoding='utf-8')
            out = root / 'generated'
            stdout = StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(main([str(source), '-o', str(out), '--run']), 0)
            self.assertIn('POLARS: PIPELINE ventas_por_cliente ejecutado', stdout.getvalue())
            # Ejecutar el módulo generado en otro directorio prueba independencia del cwd.
            result = subprocess.run([sys.executable, str(out / 'polars.py')], cwd=temp,
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('POLARS', result.stdout)

    def test_cli_reports_missing_source_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'bad.etl'
            source.write_text('PIPELINE p { FROM CSV(file: "missing.csv"); TO OUTPUT o: TABLE; }', encoding='utf-8')
            stderr = StringIO()
            with redirect_stderr(stderr), redirect_stdout(StringIO()):
                self.assertEqual(main([str(source), '-o', str(Path(temp) / 'out'), '--run']), 1)
            self.assertIn('E_SOURCE', stderr.getvalue())
            self.assertNotIn('Traceback', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
