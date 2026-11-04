from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import duckdb

from etl_dsl import CompileError, compile_program, parse, parse_file
from etl_dsl.main import main
from etl_dsl.runtime import DuckDBRuntime, ExecutionError, run_pipelines
from scripts.create_demo_data import create_demo_data


ROOT = Path(__file__).resolve().parents[1]


def generated(source, base_dir="."):
    code = compile_program(parse(source), base_dir=base_dir)
    namespace = {"__name__": "test_generated"}
    exec(compile(code, "generated.py", "exec"), namespace)
    return namespace


def single(operation, schema="id: INT, x: DECIMAL?, s: STRING?"):
    return f"""PIPELINE p {{ INPUT data: TABLE[{schema}];
    STEP step = {operation}
    OUTPUT result: TABLE; FLOW {{ data -> step -> result; }} }}"""


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.rt = DuckDBRuntime()
        self.addCleanup(self.rt.connection.close)

    def rows(self, table, order=""):
        return self.rt.connection.execute(f"SELECT * FROM {table.sql} {order}").fetchall()

    def evaluate(self, source, sql):
        module = generated(source)
        return module["PIPELINES"]["p"](self.rt, {"data": self.rt.query(sql)})["result"]

    def test_filter_null_logic_math_and_scalar_functions(self):
        source = '''PIPELINE p { INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?];
 STEP f = FILTER { WHERE NOT id < 0 AND (x IS NULL OR x >= 0); }
 STEP d = DERIVE { ratio = SAFE_DIVIDE(x, id); cleaned = LOWER(TRIM(COALESCE(s, "NA")));
     z = NULLIF(id, 0); flag = x IS NULL; calc = (id + 2) * 3 - 1; }
 OUTPUT result: TABLE; FLOW { data -> f -> d -> result; } }'''
        table = self.evaluate(source, "SELECT * FROM (VALUES (0, 5.0, ' A '), (2, 6.0, NULL), (3, NULL, ''), (-1, 1, 'b')) t(id,x,s)")
        rows = self.rows(table, 'ORDER BY id')
        self.assertEqual([(r[0], *r[3:]) for r in rows],
                         [(0, None, 'a', None, False, 5), (2, 3.0, 'na', 2, False, 11), (3, None, '', 3, True, 14)])
        filtered = self.evaluate(single('FILTER { WHERE x > 0; }'),
                                 "SELECT * FROM (VALUES (1, NULL, NULL), (2, 0, ''), (3, 4, 'ok')) t(id,x,s)")
        self.assertEqual([r[0] for r in self.rows(filtered)], [3])

    def test_drop_fill_rename_distinct_select_and_sort(self):
        source = '''PIPELINE p { INPUT data: TABLE[id: INT?, x: DECIMAL?, s: STRING?];
 STEP drop = DROP_NULLS { COLUMNS id; }
 STEP fill = FILL_NULL { x = 7; s = UPPER(COALESCE(s, "unknown")); }
 STEP rename = RENAME { id AS key; }
 STEP unique = DISTINCT { COLUMNS key, x, s; }
 STEP sort = SORT { BY key DESC; }
 STEP select = SELECT { COLUMNS key, x; }
 OUTPUT result: TABLE; FLOW { data -> drop -> fill -> rename -> unique -> sort -> select -> result; } }'''
        table = self.evaluate(source, "SELECT * FROM (VALUES (NULL, 1, NULL), (1, NULL, NULL), (2, 0, ''), (2, 0, '')) t(id,x,s)")
        self.assertEqual(table.columns, ('key', 'x'))
        self.assertEqual(self.rows(table), [(2, 0), (1, 7)])
        # FILL_NULL conserva los valores no nulos y usa solo la entrada original.
        table = self.evaluate(single('FILL_NULL { x = id; s = "fallback"; }'),
                              "SELECT 1 AS id, 0 AS x, '' AS s")
        self.assertEqual(self.rows(table), [(1, 0, '')])

    def test_aggregate_count_nulls_and_empty_input(self):
        op = 'AGGREGATE { COUNT() AS n; COUNT(x) AS nx; SUM(x) AS total; AVG(x) AS average; MIN(x) AS lo; MAX(x) AS hi; }'
        table = self.evaluate(single(op), "SELECT * FROM (VALUES (1, 5, NULL::VARCHAR), (2, NULL, NULL), (3, 7, NULL)) t(id,x,s)")
        self.assertEqual(self.rows(table)[0], (3, 2, 12, 6.0, 5, 7))
        table = self.evaluate(single(op), "SELECT 1 AS id, 2 AS x, '' AS s WHERE FALSE")
        self.assertEqual(self.rows(table), [(0, 0, None, None, None, None)])

    def test_group_by(self):
        table = self.evaluate(single('AGGREGATE { GROUP_BY s; COUNT() AS n; SUM(x) AS total; }'),
                              "SELECT * FROM (VALUES (1, 2, 'a'), (2, 3, 'a'), (3, NULL, 'b')) t(id,x,s)")
        self.assertEqual(self.rows(table, 'ORDER BY s'), [('a', 2, 5), ('b', 1, None)])

    def test_join_types_multiple_conditions_and_null_keys(self):
        for kind, count in [('INNER', 1), ('LEFT', 3), ('RIGHT', 3), ('FULL', 5)]:
            source = f'''PIPELINE p {{
 INPUT a: TABLE[id: INT?, a: INT]; INPUT b: TABLE[key: INT?, b: INT];
 STEP j = JOIN {{ TYPE {kind}; ON left.id == right.key AND left.a == right.b; }}
 OUTPUT o: TABLE; FLOW {{ a -> j.left; b -> j.right; j -> o; }} }}'''
            module = generated(source)
            left = self.rt.query('SELECT * FROM (VALUES (1, 7), (2, 8), (NULL, 9)) t(id,a)')
            right = self.rt.query('SELECT * FROM (VALUES (1, 7), (3, 8), (NULL, 9)) t(key,b)')
            table = module['PIPELINES']['p'](self.rt, {'a': left, 'b': right})['o']
            with self.subTest(kind=kind):
                self.assertEqual(len(self.rows(table)), count)

    def test_use_multiple_instances_forward_definition_and_fanout(self):
        source = '''PIPELINE p { INPUT data: TABLE[id: INT]; USE clean AS a; USE clean AS b;
 OUTPUT result: TABLE; OUTPUT other: TABLE;
 FLOW { data -> a.i; data -> b.i; a.o -> result; b.o -> other; } }
 PIPELINE clean { INPUT i: TABLE[id: INT]; STEP d = DERIVE { y = id * 2; }
 OUTPUT o: TABLE[id: INT, y: INT]; FLOW { i -> d -> o; } }'''
        module = generated(source)
        data = self.rt.query('SELECT 3 AS id')
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
        for op in ['DERIVE { id = 0; }', 'DERIVE { a = 1; b = a + 1; }',
                   'FILL_NULL { missing = 0; }', 'SELECT { COLUMNS ID; }',
                   'RENAME { id AS x; }', 'RENAME { missing AS new; }',
                   'DERIVE { ID = 1; }']:
            with self.subTest(op=op), self.assertRaises(ExecutionError):
                self.evaluate(single(op), "SELECT 1 AS id, 2 AS x, '' AS s")

    def test_join_ambiguous_columns_rejected(self):
        source = '''PIPELINE p { INPUT a: TABLE[id: INT]; INPUT b: TABLE[id: INT];
 STEP j = JOIN { TYPE INNER; ON left.id == right.id; }
 OUTPUT o: TABLE; FLOW { a -> j.left; b -> j.right; j -> o; } }'''
        module = generated(source)
        table = self.rt.query('SELECT 1 AS id')
        with self.assertRaisesRegex(ExecutionError, 'E_AMBIGUOUS_COLUMNS'):
            module['PIPELINES']['p'](self.rt, {'a': table, 'b': table})

    def test_contracts_and_case_sensitive_columns(self):
        for query, schema, code in [
            ('SELECT NULL::INTEGER AS id', [('id', 'INT', False)], 'E_NULL'),
            ("SELECT 'text' AS id", [('id', 'INT', False)], 'E_TYPE'),
            ('SELECT 1 AS ID', [('id', 'INT', False)], 'E_SCHEMA'),
            ('SELECT 1 AS id, 2 AS x', [('id', 'INT', False)], 'E_SCHEMA'),
        ]:
            with self.subTest(query=query), self.assertRaisesRegex(ExecutionError, code):
                self.rt.contract(self.rt.query(query), schema, 'test')

    def test_escaping_and_python_keyword_names(self):
        text = "O'Reilly \\ {text}\nline"
        source = single(f'DERIVE {{ text = {json.dumps(text)}; }}')
        result = self.evaluate(source, "SELECT 1 AS id, 2 AS x, '' AS s")
        self.assertEqual(self.rows(result)[0][-1], text)
        source = single('FILTER { WHERE id > 0; }').replace('PIPELINE p', 'PIPELINE class')
        self.assertIn('class', generated(source)['PIPELINES'])

    def test_connector_errors_are_compile_time_and_no_source_io(self):
        source = 'PIPELINE p { SOURCE x = CSV(file: "does-not-exist.csv"); OUTPUT o: TABLE; FLOW { x -> o; } }'
        compile_program(parse(source))
        for connector in ['UNKNOWN(file: "x")', 'CSV()', 'CSV(file: 2)',
                          'CSV(file: "x", header: "yes")', 'CSV(file: "x", delimiter: "::")',
                          'PARQUET(file: "x", table: "t")', 'DUCKDB(file: "x")']:
            with self.subTest(connector=connector), self.assertRaises(CompileError):
                compile_program(parse(source.replace('CSV(file: "does-not-exist.csv")', connector)))


class ConnectorTests(unittest.TestCase):
    def test_csv_preserves_null_empty_string_zero_and_options(self):
        with tempfile.TemporaryDirectory() as temp, DuckDBRuntime(temp) as rt:
            table = rt.query("SELECT * FROM (VALUES (0, ''), (1, NULL), (2, 'NA')) t(id,s)")
            for options in [{'file': 'a.csv'}, {'file': 'b.csv', 'delimiter': ';', 'nullstr': 'NULL'}]:
                rt.sink(table, 'CSV', options, 'test')
                loaded = rt.source('CSV', options, None, 'test')
                self.assertEqual(rt.connection.execute('SELECT * FROM ' + loaded.sql + ' ORDER BY id').fetchall(),
                                 [(0, ''), (1, None), (2, 'NA')])

    def test_original_examples_execute_on_real_duckdb(self):
        with tempfile.TemporaryDirectory() as temp:
            create_demo_data(temp)
            for path in ('credit_risk.etl', 'duckdb.etl'):
                namespace = {'__name__': 'test_generated'}
                code = compile_program(parse_file(ROOT / 'input' / path), base_dir=temp)
                exec(compile(code, path + '.py', 'exec'), namespace)
                with DuckDBRuntime(temp) as rt:
                    results = run_pipelines(rt, namespace['PIPELINES'], namespace['DEFAULT_PIPELINES'])
                    self.assertNotIn('clean_orders', results)
            with duckdb.connect(':memory:') as con:
                rows = con.execute('SELECT * FROM read_parquet(?) ORDER BY cliente_id',
                                   [str(Path(temp) / 'out/ventas_por_cliente.parquet')]).fetchall()
                self.assertEqual(rows, [(1, Decimal('150.00'), 2), (2, Decimal('25.00'), 1)])
                rows = con.execute('SELECT * FROM read_parquet(?) ORDER BY segment_label',
                                   [str(Path(temp) / 'summary.parquet')]).fetchall()
                self.assertEqual(rows, [('A', 1, 1, 0.2), ('UNKNOWN', 1, 1, 0.0)])
                rows = con.execute('SELECT * FROM read_csv(?) ORDER BY customer_id',
                                   [str(Path(temp) / 'orders_clean.csv')]).fetchall()
                self.assertEqual(rows, [(1, 10.5, 'paid'), (2, 0.0, 'UNKNOWN'), (9, 30.0, 'pending')])

    def test_csv_parquet_and_native_duckdb_sink_modes(self):
        with tempfile.TemporaryDirectory() as temp, DuckDBRuntime(temp) as rt:
            table = rt.query("SELECT 3 AS id, 'a' AS s")
            for driver, file in [('CSV', 'nested/a.csv'), ('PARQUET', 'nested/a.parquet')]:
                options = {'file': file}
                rt.sink(table, driver, options, 'test')
                # La misma salida puede regenerarse.
                rt.sink(table, driver, options, 'test')
                loaded = rt.source(driver, options, None, 'test')
                self.assertEqual(rt.connection.execute('SELECT * FROM ' + loaded.sql).fetchall(), [(3, 'a')])
            options = {'file': 'out.duckdb', 'table': 'select', 'schema': 'report'}
            rt.sink(table, 'DUCKDB', options, 'test')
            with self.assertRaises(ExecutionError):
                rt.sink(table, 'DUCKDB', options, 'test')
            rt.sink(table, 'DUCKDB', {**options, 'mode': 'replace'}, 'test')
            rt.sink(table, 'DUCKDB', {**options, 'mode': 'append'}, 'test')
            loaded = rt.source('DUCKDB', {k: v for k, v in options.items() if k != 'mode'}, None, 'test')
            self.assertEqual(rt.connection.execute('SELECT count(*) FROM ' + loaded.sql).fetchone()[0], 2)

    def test_cli_compile_run_and_generated_script(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            create_demo_data(root)
            # El nombre duckdb.py no debe ocultar la biblioteca del motor.
            source = root / 'duckdb.etl'
            source.write_text((ROOT / 'input/duckdb.etl').read_text(encoding='utf-8'), encoding='utf-8')
            out = root / 'generated'
            stdout = StringIO()
            with redirect_stdout(stdout):
                self.assertEqual(main([str(source), '-o', str(out), '--run']), 0)
            self.assertIn('DUCKDB: PIPELINE ventas_por_cliente ejecutado', stdout.getvalue())
            # Ejecutar el módulo generado en otro directorio prueba independencia del cwd.
            result = subprocess.run([sys.executable, str(out / 'duckdb.py')], cwd=temp,
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('DUCKDB', result.stdout)

    def test_cli_reports_missing_source_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'bad.etl'
            source.write_text('PIPELINE p { SOURCE x = CSV(file: "missing.csv"); OUTPUT o: TABLE; FLOW { x -> o; } }', encoding='utf-8')
            stderr = StringIO()
            with redirect_stderr(stderr), redirect_stdout(StringIO()):
                self.assertEqual(main([str(source), '-o', str(Path(temp) / 'out'), '--run']), 1)
            self.assertIn('E_SOURCE', stderr.getvalue())
            self.assertNotIn('Traceback', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
