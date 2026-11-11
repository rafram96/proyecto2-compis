"""Reglas estáticas, precisión de intervalos y paridad con las rutas públicas."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import polars as pl

from etl_dsl import analyze, compile_program, parse, CompileError
from etl_dsl.backend import build_ir
from etl_dsl.runtime import PolarsRuntime


def program(op, schema='id: INT, x: DECIMAL?, s: STRING?'):
    return f'PIPELINE p {{ INPUT data: TABLE[{schema}]; STEP step = {op} OUTPUT o: TABLE; FLOW {{ data -> step -> o; }} }}'


def schema_at(source, node='step', pipe='p', port=''):
    result = analyze(source, artifacts=('schemas',))
    if not result.ok:
        raise AssertionError(result.diagnostics)
    return result.artifacts['schemas'].data[pipe][node][port]


def columns(source, **kwargs):
    return {c['name']: c for c in schema_at(source, **kwargs)['columns']}


class SemanticTests(unittest.TestCase):
    def rejects(self, source, code, fragment=None):
        result = analyze(source)
        self.assertFalse(result.ok, source)
        diag = next(d for d in result.diagnostics if d.code == code)
        self.assertEqual(diag.phase, 'semantic')
        if fragment:
            self.assertEqual(source[diag.span.start:diag.span.end], fragment)
        check = analyze(source, artifacts=())
        self.assertEqual(result.diagnostics, check.diagnostics)
        for compile_fn in (compile_program, build_ir):
            with self.assertRaises(CompileError) as error:
                compile_fn(parse(source))
            self.assertEqual(error.exception.diagnostic, result.diagnostics[0])
        return result

    def test_missing_columns_all_reference_forms_and_precise_ranges(self):
        for operation in ('FILTER { WHERE missing > 0; }', 'DERIVE { y = missing; }',
                          'SELECT { COLUMNS id, missing; }', 'DISTINCT { COLUMNS missing; }',
                          'DROP_NULLS { COLUMNS missing; }', 'SORT { BY missing DESC; }',
                          'RENAME { missing AS y; }', 'FILL_NULL { missing = 0; }',
                          'AGGREGATE { GROUP_BY missing; COUNT() AS n; }'):
            with self.subTest(operation=operation):
                self.rejects(program(operation), 'E_COLUMN', 'missing')

    def test_predicates_and_invalid_expressions(self):
        for expression in ('x + 1', 'id', '"text"', 'NULL'):
            self.rejects(program(f'FILTER {{ WHERE {expression}; }}'), 'E_TYPE', expression)
        for expression in ('s + 1', 'x AND TRUE', 'NOT id', 'LOWER(id)', 'SAFE_DIVIDE(s, id)',
                           'id == s', 'NULLIF(id, s)', 'SUM(s)', 'LOWER(NULL)', 'NOT NULL', '-NULL'):
            op = f'AGGREGATE {{ {expression} AS n; }}' if expression.startswith('SUM') else f'DERIVE {{ y = {expression}; }}'
            with self.subTest(expression=expression):
                self.rejects(program(op), 'E_TYPE')

    def test_assignment_scope_and_new_names(self):
        for operation in ('DERIVE { id = 0; }', 'DERIVE { ID = 0; }', 'DERIVE { a = 1; b = a + 1; }'):
            result = analyze(program(operation))
            self.assertFalse(result.ok)
        source = program('DERIVE { a = 1; b = a + 1; }').replace('INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?]', 'SOURCE data = CSV(file: "absent.csv")')
        self.rejects(source, 'E_COLUMN', 'a')
        # FILL_NULL lee el s original, aunque la asignación anterior lo rellene.
        c = columns(program('FILL_NULL { s = "ok"; x = NULLIF(id, 0); }'))
        self.assertFalse(c['s']['nullable'])
        self.assertTrue(c['x']['nullable'])
        c = columns(program('FILL_NULL { x = id; id = x; }', 'id: INT?, x: INT?'))
        self.assertTrue(c['id']['nullable'])
        self.assertTrue(c['x']['nullable'])

    def test_all_ten_operations_and_column_order(self):
        source = '''PIPELINE p { INPUT i: TABLE[id: INT?, s: STRING?]; INPUT j: TABLE[key: INT];
        STEP f = FILTER { WHERE id > 0; }
        STEP d = DERIVE { y = id * 2; }
        STEP fill = FILL_NULL { s = "ok"; }
        STEP drop = DROP_NULLS { COLUMNS id; }
        STEP rename = RENAME { id AS code; }
        STEP select = SELECT { COLUMNS s, code, y; }
        STEP distinct = DISTINCT { COLUMNS code, y; }
        STEP sort = SORT { BY y DESC; }
        STEP join = JOIN { TYPE LEFT; ON left.code == right.key; }
        STEP agg = AGGREGATE { GROUP_BY code; SUM(y) AS total; COUNT() AS n; }
        OUTPUT o: TABLE;
        FLOW { i -> f -> d -> fill -> drop -> rename -> select -> distinct -> sort -> join.left; j -> join.right; join -> agg -> o; } }'''
        data = analyze(source, artifacts=('schemas',)).artifacts['schemas'].data['p']
        self.assertEqual([c['name'] for c in data['select']['']['columns']], ['s', 'code', 'y'])
        self.assertEqual([c['name'] for c in data['distinct']['']['columns']], ['code', 'y'])
        self.assertEqual([c['name'] for c in data['join']['']['columns']], ['code', 'y', 'key'])
        self.assertFalse(data['d']['']['columns'][-1]['nullable'])
        self.assertFalse(data['fill']['']['columns'][1]['nullable'])
        self.assertEqual([c['name'] for c in data['agg']['']['columns']], ['code', 'total', 'n'])

    def test_filter_refinement_and_boolean_branches(self):
        for pred, nullable in [('x IS NOT NULL', False), ('x > 0', False),
                               ('NOT x IS NULL', False), ('NOT x > 0', False), ('x > 0 AND id > 0', False),
                               ('x > 0 OR x < 0', False), ('x > 0 OR id > 0', True)]:
            with self.subTest(pred=pred):
                self.assertEqual(columns(program(f'FILTER {{ WHERE {pred}; }}'))['x']['nullable'], nullable)
        self.assertFalse(columns(program('DROP_NULLS { COLUMNS x; }'))['x']['nullable'])
        self.assertFalse(columns(program('FILTER { WHERE flag; }', 'flag: BOOL?'))['flag']['nullable'])
        self.assertFalse(columns(program('FILTER { WHERE NOT flag; }', 'flag: BOOL?'))['flag']['nullable'])

    def test_scalar_functions_and_numeric_families(self):
        c = columns(program('DERIVE { a = id / 2; b = COALESCE(x, 0); c = NULLIF(id, 0); d = SAFE_DIVIDE(id, id); e = UPPER(s); f = NULL; }'))
        self.assertEqual(c['a']['types'], ['REAL'])
        self.assertFalse(c['b']['nullable'])
        for name in ('c', 'd', 'e', 'f'):
            self.assertTrue(c[name]['nullable'])
        self.assertEqual(c['f']['types'], [])
        self.assertEqual(columns(program('DERIVE { y = NULL / id; }'))['y']['types'], ['REAL'])
        self.assertEqual(columns(program('DERIVE { y = NULL / NULL; }'))['y']['types'], ['REAL'])
        self.rejects(program('DERIVE { y = NULL * s; }'), 'E_TYPE')
        self.assertEqual(columns(program('DERIVE { y = 0.1 + 0.2; }'))['y']['types'], ['FIXED'])

    def test_aggregations_empty_and_nonempty_groups(self):
        op = 'AGGREGATE { COUNT() AS n; COUNT(id) AS ni; SUM(id) AS total; AVG(id) AS avg; MIN(id) AS lo; MAX(id) AS hi; }'
        c = columns(program(op))
        self.assertEqual(c['n']['types'], ['INT'])
        self.assertFalse(c['ni']['nullable'])
        for n in ('total', 'avg', 'lo', 'hi'):
            self.assertTrue(c[n]['nullable'])
        self.assertEqual(c['avg']['types'], ['REAL'])
        c = columns(program('AGGREGATE { GROUP_BY s; SUM(id) AS total; SUM(x) AS maybe; }'))
        self.assertFalse(c['total']['nullable'])
        self.assertTrue(c['maybe']['nullable'])

    def test_joins_kinds_keys_and_ambiguity(self):
        for kind, expected in [('INNER', (False, False)), ('LEFT', (True, True)),
                               ('RIGHT', (True, True)), ('FULL', (True, True))]:
            src = f'''PIPELINE p {{ INPUT a: TABLE[id: INT?, x: INT]; INPUT b: TABLE[key: INT?, y: INT];
            STEP j = JOIN {{ TYPE {kind}; ON right.key == left.id; }} OUTPUT o: TABLE;
            FLOW {{ a -> j.left; b -> j.right; j -> o; }} }}'''
            c = columns(src, node='j')
            self.assertEqual((c['id']['nullable'], c['key']['nullable']), expected)
            self.assertEqual(c['x']['nullable'], kind in {'RIGHT', 'FULL'})
            self.assertEqual(c['y']['nullable'], kind in {'LEFT', 'FULL'})
        self.rejects(src.replace('left.id', 'left.missing'), 'E_COLUMN', 'left.missing')
        self.rejects(src.replace('key: INT?', 'key: STRING?'), 'E_TYPE')
        self.rejects(src.replace('y: INT', 'X: INT'), 'E_AMBIGUOUS_COLUMNS')

    def test_output_contracts_and_runtime_null_checks(self):
        src = program('SELECT { COLUMNS id, s; }')
        self.rejects(src.replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[s: STRING?, id: INT];'), 'E_SCHEMA')
        self.rejects(src.replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[id: STRING, s: STRING?];'), 'E_TYPE')
        valid = src.replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[id: INT, s: STRING];')
        # La posibilidad de NULL no demuestra una violación: el contrato puede filtrar en runtime.
        self.assertFalse(columns(valid, node='o')['s']['nullable'])
        self.assertIn('rt.contract', compile_program(parse(valid)))
        null_dtype = program('SELECT { COLUMNS x; }').replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[x: INT?];')
        self.assertTrue(analyze(null_dtype).ok)  # DECIMAL puede ser entero: no inventar precisión.

    def test_use_forward_multi_input_output_and_specialization(self):
        src = '''PIPELINE main { INPUT i: TABLE[id: INT]; INPUT j: TABLE[z: STRING]; USE child AS c;
        OUTPUT o: TABLE[id: INT, y: INT]; OUTPUT q: TABLE[z: STRING];
        FLOW { i -> c.a; j -> c.b; c.x -> o; c.z -> q; } }
        PIPELINE child { INPUT a: TABLE[id: DECIMAL]; INPUT b: TABLE[z: STRING];
        STEP d = DERIVE { y = id * 2; } OUTPUT x: TABLE; OUTPUT z: TABLE;
        FLOW { a -> d -> x; b -> z; } }'''
        c = columns(src, node='c', pipe='main', port='x')
        self.assertEqual(c['y']['types'], ['INT'])
        self.rejects(src.replace('INPUT i: TABLE[id: INT]', 'INPUT i: TABLE[id: STRING]'), 'E_TYPE')
        self.rejects(src.replace('INPUT j: TABLE[z: STRING]', 'INPUT j: TABLE[other: STRING]'), 'E_SCHEMA')

    def test_unknown_partial_schemas_do_not_invent_information(self):
        src = 'PIPELINE p { SOURCE i = CSV(file: "missing.csv"); STEP d = DERIVE { a = 1; } STEP s = SELECT { COLUMNS a, unknown; } OUTPUT o: TABLE; FLOW { i -> d -> s -> o; } }'
        initial = schema_at(src, node='i')
        self.assertFalse(initial['complete'])
        self.assertEqual(initial['columns'], [])
        self.assertFalse(schema_at(src, node='d')['complete'])
        c = columns(src, node='s')
        self.assertEqual(c['a']['types'], ['INT'])
        self.assertIsNone(c['unknown']['types'])
        self.assertTrue(c['unknown']['nullable'])
        self.rejects(src.replace('a = 1', 'a = LOWER(1)'), 'E_TYPE')
        self.rejects(src.replace('COLUMNS a, unknown', 'COLUMNS a, unknown').replace('OUTPUT o: TABLE;', 'STEP f = FILTER { WHERE missing > 0; } OUTPUT o: TABLE;').replace('s -> o', 's -> f -> o'), 'E_COLUMN', 'missing')

    def test_dead_steps_still_checked_and_prior_artifacts_retained(self):
        src = program('FILTER { WHERE id > 0; }').replace('OUTPUT o: TABLE;', 'STEP dead = FILTER { WHERE missing > 1; } OUTPUT o: TABLE;').replace('data -> step', 'data -> dead; data -> step')
        r = self.rejects(src, 'E_COLUMN', 'missing')
        for artifact in ('tokens', 'tree', 'ast', 'ir_before'):
            self.assertEqual(r.artifacts[artifact].status, 'available')
        for artifact in ('schemas', 'ir_after', 'python'):
            self.assertEqual(r.artifacts[artifact].status, 'blocked')
        self.assertEqual(r.applied_passes, ())

    def test_compilation_has_no_connector_io_or_native_imports(self):
        src = 'PIPELINE p { SOURCE i: TABLE[x: INT] = CSV(file: "missing.csv"); OUTPUT o: TABLE[x: INT]; FLOW { i -> o; } }'
        parse(src)
        with patch('builtins.open', side_effect=AssertionError('IO')), patch.object(Path, 'read_text', side_effect=AssertionError('IO')):
            self.assertTrue(analyze(src).ok)
            compile_program(parse(src))
        json.dumps(analyze(src).to_dict())

    def test_partial_rename_absence_and_unknown_fill_targets(self):
        src = 'PIPELINE p { SOURCE i = PARQUET(file: "missing"); STEP r = RENAME { old AS fresh; } STEP d = DERIVE { y = old; } OUTPUT o: TABLE; FLOW { i -> r -> d -> o; } }'
        self.rejects(src, 'E_COLUMN', 'old')
        valid = src.replace('y = old', 'y = fresh')
        c = columns(valid, node='d')
        self.assertIsNone(c['fresh']['types'])
        self.assertFalse(schema_at(valid, node='d')['complete'])
        fill = valid.replace('DERIVE { y = fresh; }', 'FILL_NULL { other = 0; }')
        self.assertFalse(columns(fill, node='d')['other']['nullable'])
        self.assertIsNone(columns(fill, node='d')['other']['types'])

    def test_null_dtype_contract_and_conservative_nullable_contract(self):
        src = program('DERIVE { y = NULL; }').replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[id: INT, x: DECIMAL?, s: STRING?, y: INT?];')
        self.rejects(src, 'E_TYPE')
        src = program('SELECT { COLUMNS s; }').replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[s: STRING];')
        namespace = {'__name__': 'semantic_test'}
        exec(compile_program(parse(src)), namespace)
        # Una tabla sin filas satisface el contrato aunque el esquema pueda contener nulos.
        empty = pl.DataFrame(schema={'id': pl.Int64, 'x': pl.Float64, 's': pl.String})
        result = namespace['PIPELINES']['p'](PolarsRuntime(), {'data': empty})['o'].collect()
        self.assertEqual(result.height, 0)

    def test_temporal_and_boolean_rules(self):
        for expr, expected in [('a - b', ['DURATION']), ('COALESCE(a, b)', ['DATE']), ('COALESCE(a, 1)', ['INT'])]:
            self.assertEqual(columns(program(f'DERIVE {{ y = {expr}; }}', 'a: DATE, b: DATE'))['y']['types'], expected)
        self.rejects(program('DERIVE { y = COALESCE(a, TRUE); }', 'a: DATE'), 'E_TYPE')
        self.rejects(program('FILL_NULL { a = TRUE; }', 'a: DATE?'), 'E_TYPE')
        c = columns(program('AGGREGATE { AVG(a) AS y; }', 'a: DATE'))
        self.assertEqual(c['y']['types'], ['DATETIME'])
        self.assertEqual(columns(program('DERIVE { y = SAFE_DIVIDE(a, a); }', 'a: BOOL'))['y']['types'], ['REAL'])
        c = columns(program('AGGREGATE { SUM(a) AS y; AVG(a) AS z; }', 'a: BOOL'))
        self.assertEqual(c['y']['types'], ['INT'])
        self.assertEqual(c['z']['types'], ['REAL'])

    def test_proven_different_join_numeric_types(self):
        src = '''PIPELINE p { INPUT a: TABLE[id: INT]; INPUT b: TABLE[key: INT];
        STEP d = DERIVE { real_key = key / 2; }
        STEP j = JOIN { TYPE INNER; ON left.id == right.real_key; }
        OUTPUT o: TABLE; FLOW { a -> j.left; b -> d -> j.right; j -> o; } }'''
        self.rejects(src, 'E_TYPE')

    def test_inferred_types_match_runtime_for_valid_edge_cases(self):
        for expr in ('id + TRUE', 's + TRUE', 'COALESCE(id, s)', 'id / 2', 'SAFE_DIVIDE(id, 0)', 'NULLIF(id, 1)'):
            src = program(f'DERIVE {{ y = {expr}; }}')
            namespace = {'__name__': 'semantic_test'}
            exec(compile_program(parse(src)), namespace)
            table = pl.DataFrame({'id': [1], 'x': [2.0], 's': ['a']})
            result = namespace['PIPELINES']['p'](PolarsRuntime(), {'data': table})['o'].collect()
            actual = result.schema['y']
            tags = columns(src)['y']['types']
            tag = 'STRING' if actual == pl.String else 'REAL' if actual.is_float() else 'INT' if actual.is_integer() else 'FIXED'
            self.assertIn(tag, tags, expr)
            if not columns(src)['y']['nullable']:
                self.assertEqual(result['y'].null_count(), 0)


if __name__ == '__main__':
    unittest.main()
