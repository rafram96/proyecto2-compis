"""Equivalencia O1 con Polars, incluidas ramas, nulos y límites de precisión."""
from decimal import Decimal
from itertools import permutations
import json
from pathlib import Path
import random
import unittest
from unittest.mock import patch

import polars as pl

from etl_dsl import analyze, compile_program, parse, CompileError
from etl_dsl.backend import build_ir
from etl_dsl.facts import MAX_EXACT
from etl_dsl.ir import format_module, lower
from etl_dsl.passes import DEFAULT, optimize
from etl_dsl.runtime import PolarsRuntime, ExecutionError


def chain(first='x >= 100', second='x >= 0', middle='', dtype='INT?'):
    return f'''PIPELINE p {{ INPUT i: TABLE[x: {dtype}];
    STEP a = FILTER {{ WHERE {first}; }}
    {middle}
    STEP b = FILTER {{ WHERE {second}; }} OUTPUT o: TABLE;
    FLOW {{ i -> a -> {'m -> ' if middle else ''}b -> o; }} }}'''


def optimized(source, passes=('rangos',)):
    return build_ir(parse(source), passes)[1]


def names(module, pipe=0):
    return [n.name for n in module.pipelines[pipe].nodes]


def execute(source, data, passes):
    namespace = {'__name__': 'test_ranges'}
    exec(compile_program(parse(source), passes=passes), namespace)
    out = namespace['PIPELINES']['p'](PolarsRuntime(), data)
    return {n: f.collect() for n, f in out.items()}


class RangeTests(unittest.TestCase):
    def equivalent(self, source, data, passes=('rangos',)):
        before, after = execute(source, data, ()), execute(source, data, passes)
        self.assertEqual(before.keys(), after.keys())
        for key in before:
            self.assertEqual(before[key].schema, after[key].schema)
            self.assertTrue(before[key].equals(after[key]), (source, before[key], after[key]))
        return after

    def test_required_case_and_recorded_proof(self):
        source = chain()
        module = optimized(source)
        self.assertEqual(names(module), ['i', 'a', 'o'])
        rewrite, = module.range_rewrites
        self.assertEqual((rewrite.node, rewrite.action), ('b', 'remove_filter'))
        self.assertEqual(rewrite.consumers, ('o',))
        self.assertEqual(rewrite.origin, ('b',))
        fact, = rewrite.proof
        self.assertEqual((fact.lower.value, fact.lower.inclusive, fact.nullable), (100, True, False))
        self.assertEqual(fact.lower.evidence[0].node, 'a')
        span = fact.lower.evidence[0].span
        self.assertEqual(source[span.start:span.end], 'x >= 100')
        self.assertIn('// rangos: p.b: remove_filter', format_module(module))
        self.equivalent(source, {'i': pl.DataFrame({'x': [None, -1, 0, 99, 100, 101]})})

    def test_open_closed_lower_and_upper_bounds(self):
        cases = [('x > 100', 'x >= 100', True), ('x >= 100', 'x > 100', False),
                 ('x < 100', 'x <= 100', True), ('x <= 100', 'x < 100', False),
                 ('x < -1', 'x < 0', True), ('0 < x', 'x >= 0', True),
                 ('x == 100', 'x >= 100', True), ('x == 100', 'x <= 100', True),
                 ('x >= 100 AND x <= 100', 'x == 100', True),
                 ('x > 100', 'x != 100', True), ('x != 100', 'x > 100', False)]
        frame = pl.DataFrame({'x': [None, -2, -1, 0, 1, 99, 100, 101]})
        for first, second, removed in cases:
            with self.subTest(first=first, second=second):
                source = chain(first, second)
                self.assertEqual('b' not in names(optimized(source)), removed)
                self.equivalent(source, {'i': frame})

    def test_null_predicates_and_contradictions(self):
        for first, second, removed in [
            ('x IS NULL', 'x IS NULL', True),
            ('x IS NOT NULL', 'x IS NOT NULL', True),
            ('x >= 0', 'x IS NOT NULL', True),
            ('x IS NULL', 'x >= 0', False),
            ('x >= 0', 'x IS NULL', False),
            ('x > 100', 'x < 0', False),
            ('x >= 100', 'x < 100', False),
        ]:
            with self.subTest(first=first, second=second):
                source = chain(first, second)
                module = optimized(source)
                self.assertEqual('b' not in names(module), removed)
                self.equivalent(source, {'i': pl.DataFrame({'x': [None, -1, 0, 100, 101]})})
        source = chain('x > 100', 'x < 0 AND x IS NOT NULL')
        module = optimized(source)
        self.assertIn('b', names(module))
        self.assertEqual(module.pipelines[0].nodes[2].payload.predicate,
                         lower(parse(source)).pipelines[0].nodes[2].payload.predicate)
        self.assertTrue(next(f for f in module.range_facts if f.node == 'b').contradictory)

    def test_partial_simplification_and_intra_filter_facts(self):
        source = chain(second='x >= 0 AND x < 110')
        module = optimized(source)
        self.assertEqual(module.range_rewrites[0].action, 'simplify_predicate')
        self.assertIn('FILTER(%a) { x < 110 }', format_module(module))
        self.equivalent(source, {'i': pl.DataFrame({'x': [None, 100, 109, 110, 200]})})
        source = chain(first='x > 100 AND x >= 0', second='x < 1000')
        self.assertEqual(optimized(source).range_rewrites[0].node, 'a')

    def test_select_rename_sort_distinct_and_drop_nulls(self):
        for middle, predicate in [
            ('SELECT { COLUMNS x; }', 'x >= 0'),
            ('RENAME { x AS amount; }', 'amount >= 0'),
            ('SORT { BY x DESC; }', 'x >= 0'),
            ('DISTINCT { COLUMNS x; }', 'x >= 0'),
            ('DROP_NULLS { COLUMNS x; }', 'x IS NOT NULL'),
        ]:
            with self.subTest(middle=middle):
                source = chain(second=predicate, middle=f'STEP m = {middle}')
                self.assertNotIn('b', names(optimized(source)))
                self.equivalent(source, {'i': pl.DataFrame({'x': [None, 0, 100, 100, 200]})})

    def test_derive_literals_aliases_and_original_assignment_scope(self):
        source = chain(second='y >= 0', middle='STEP m = DERIVE { y = 101; z = x; }')
        self.assertNotIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [0, 100, 200]})})
        source = chain(second='y >= 0', middle='STEP m = DERIVE { y = x; }')
        self.assertNotIn('b', names(optimized(source)))
        source = chain(second='y >= 0', middle='STEP m = DERIVE { y = x - 1000; }')
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [100, 999, 1000, 1001]})})
        null_source = chain(second='y IS NULL', middle='STEP m = DERIVE { y = NULL; }')
        self.assertNotIn('b', names(optimized(null_source)))
        self.equivalent(null_source, {'i': pl.DataFrame({'x': [100, 200]})})
        with self.assertRaises(CompileError):
            optimized(chain(middle='STEP m = DERIVE { x = 0; }'))
        # Redefinición legal después de retirar el nombre original.
        source = '''PIPELINE p { INPUT i: TABLE[x: INT]; STEP a = FILTER { WHERE x >= 100; }
        STEP r = RENAME { x AS old; } STEP d = DERIVE { x = -1; }
        STEP b = FILTER { WHERE x >= 0; } OUTPUT o: TABLE;
        FLOW { i -> a -> r -> d -> b -> o; } }'''
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [100, 200]})})

    def test_fill_null_invalidates_range_even_when_non_nullable(self):
        source = chain(middle='STEP m = FILL_NULL { x = 0; }')
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [None, 0, 100, 200]})})

    def test_shared_branches_never_leak_constraints(self):
        source = '''PIPELINE p { INPUT i: TABLE[x: INT?]; STEP a = FILTER { WHERE x >= 100; }
        STEP b = FILTER { WHERE x >= 0; } STEP c = FILTER { WHERE x >= 0; }
        OUTPUT one: TABLE; OUTPUT two: TABLE; OUTPUT three: TABLE;
        FLOW { i -> a -> b -> one; i -> c -> two; a -> three; } }'''
        module = optimized(source)
        self.assertNotIn('b', names(module))
        self.assertIn('a', names(module))
        self.assertIn('c', names(module))
        out = self.equivalent(source, {'i': pl.DataFrame({'x': [None, -1, 0, 99, 100]})})
        self.assertEqual(out['two']['x'].to_list(), [0, 99, 100])

    def test_aggregate_and_use_do_not_inherit_ranges(self):
        source = chain(second='x >= 0', middle='STEP m = AGGREGATE { SUM(x) AS x; }')
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [None, 0, 100, 200]})})
        source = '''PIPELINE p { INPUT i: TABLE[x: INT?]; STEP a = FILTER { WHERE x >= 100; }
        USE child AS c; STEP b = FILTER { WHERE x >= 0; } OUTPUT o: TABLE;
        FLOW { i -> a -> c.i; c.o -> b -> o; } }
        PIPELINE child { INPUT i: TABLE[x: INT?]; OUTPUT o: TABLE; FLOW { i -> o; } }'''
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [None, 0, 100]})})

    def test_all_join_kinds_widen_facts_and_keep_external_nulls(self):
        for kind in ('INNER', 'LEFT', 'RIGHT', 'FULL'):
            source = f'''PIPELINE p {{ INPUT i: TABLE[x: INT?]; INPUT j: TABLE[y: INT?];
            STEP a = FILTER {{ WHERE y >= 100; }} STEP join = JOIN {{ TYPE {kind}; ON left.x == right.y; }}
            STEP b = FILTER {{ WHERE y >= 0; }} OUTPUT o: TABLE;
            FLOW {{ i -> join.left; j -> a -> join.right; join -> b -> o; }} }}'''
            self.assertIn('b', names(optimized(source)))
            self.equivalent(source, {'i': pl.DataFrame({'x': [None, 0, 100, 200]}),
                                     'j': pl.DataFrame({'y': [None, 0, 100]})})

    def test_unknown_and_decimal_literal_thresholds_abstain(self):
        source = chain().replace('INPUT i: TABLE[x: INT?]', 'SOURCE i = CSV(file: "absent.csv")')
        self.assertIn('b', names(optimized(source)))
        for first, second in [('x >= 0.1', 'x >= 0.0'),
                              (f'x >= {MAX_EXACT + 2}', f'x > {MAX_EXACT + 1}')]:
            source = chain(first, second, dtype='DECIMAL?')
            self.assertIn('b', names(optimized(source)))
        for predicate in ('x >= 0 OR x IS NULL', 'NOT x < 0', 'x + 1 >= 0'):
            self.assertIn('b', names(optimized(chain(second=predicate))))

    def test_floats_nan_infinities_decimals_and_empty_frames(self):
        float16 = [(pl.Float16, [None, float('nan'), float('inf'), -float('inf'), 0., 100., 101.])] if hasattr(pl, 'Float16') else []
        for schema, values in float16 + [
            (pl.Float32, [None, float('nan'), float('inf'), -float('inf'), 0., 100., 101.]),
            (pl.Float64, [None, float('nan'), float('inf'), -float('inf'), -1., 0., 99.9, 100., 100.1]),
            (pl.Decimal(20, 2), [None, Decimal('-1'), Decimal('0'), Decimal('99.99'), Decimal('100')]),
            (pl.Int64, []),
        ]:
            source = chain(dtype='DECIMAL?')
            self.assertNotIn('b', names(optimized(source)))
            self.equivalent(source, {'i': pl.DataFrame({'x': values}, schema={'x': schema})})

    def test_rounding_counterexample_is_not_optimized(self):
        source = chain(f'x >= {2**53 + 1}', f'x > {2**53}', dtype='DECIMAL?')
        self.assertIn('b', names(optimized(source)))
        self.equivalent(source, {'i': pl.DataFrame({'x': [float(2**53), float(2**53 + 2)]})})
        floats = [(24, pl.Float32), (53, pl.Float64)]
        if hasattr(pl, 'Float16'):
            floats.append((11, pl.Float16))
        for bits, dtype in floats:
            source = chain(f'x >= {2**bits + 1}', f'x > {2**bits}', dtype='DECIMAL?')
            self.assertIn('b', names(optimized(source)))
            self.equivalent(source, {'i': pl.DataFrame({'x': [float(2**bits), float(2**bits + 2)]}, schema={'x': dtype})})
        # Un INT conocido no necesita la restricción de mantisa de REAL.
        self.assertNotIn('b', names(optimized(chain('x >= 100000', 'x >= 0'))))

    def test_pass_order_combinations_and_repeated_application(self):
        source = chain(first='x >= 10 * 10', second='x >= 0 AND x < 1000')
        frame = {'i': pl.DataFrame({'x': [None, -1, 0, 99, 100, 999, 1000]})}
        for order in permutations(('constantes', 'rangos', 'filtros', 'muertos')):
            with self.subTest(order=order):
                self.equivalent(source, frame, order)
        module = optimized(chain())
        self.assertEqual(format_module(module), format_module(optimize(module, ('rangos',))))
        self.assertNotIn('b', names(optimized(chain(), DEFAULT)))

    def test_seeded_predicate_matrix_equivalence(self):
        rng = random.Random(383)
        frame = {'i': pl.DataFrame({'x': [None] + list(range(-5, 6))})}
        for _ in range(40):
            first = f'x {rng.choice([">", ">=", "<", "<=", "==", "!="])} {rng.randint(-4, 4)}'
            second = f'x {rng.choice([">", ">=", "<", "<=", "==", "!="])} {rng.randint(-4, 4)}'
            self.equivalent(chain(first, second), frame)

    def test_runtime_contract_errors_remain_observable(self):
        source = chain(dtype='INT')
        for frame, code in [(pl.DataFrame({'x': ['text']}), 'E_TYPE'),
                            (pl.DataFrame({'x': [None]}, schema={'x': pl.Int64}), 'E_NULL')]:
            errors = []
            for passes in ((), ('rangos',), DEFAULT):
                with self.assertRaises(ExecutionError) as error:
                    execute(source, {'i': frame}, passes)
                self.assertIn(code, str(error.exception))
                errors.append(str(error.exception))
            self.assertEqual(len(set(errors)), 1)

    def test_api_parity_serialization_and_no_connector_io(self):
        source = chain()
        result = analyze(source)
        before, after = build_ir(parse(source))
        self.assertEqual(result.artifacts['python'].data, compile_program(parse(source)))
        self.assertEqual(result.artifacts['ir_after'].data['module']['range_rewrites'][0]['node'], 'b')
        json.dumps(result.to_dict())
        with patch('builtins.open', side_effect=AssertionError('IO')), \
             patch.object(Path, 'read_text', side_effect=AssertionError('IO')):
            self.assertTrue(analyze(source).ok)
        self.assertEqual(before.range_rewrites, ())
        self.assertEqual(after.range_rewrites[0].node, 'b')
        self.assertEqual(optimized(source, ()).range_facts, ())
