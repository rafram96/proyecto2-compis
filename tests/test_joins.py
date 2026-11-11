"""C4: resultados, esquemas, obligaciones ejecutadas y abstenciones de O3."""
from itertools import permutations
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import polars as pl

from etl_dsl import analyze, compile_program, parse, CompileError
from etl_dsl.backend import build_ir
from etl_dsl.passes import DEFAULT
from etl_dsl.runtime import PolarsRuntime, ExecutionError


def program(select='x', guarantee='VERIFY MANY_TO_ONE;', nullable='?', extra='', flow=''):
    return f'''PIPELINE p {{ INPUT l: TABLE[x: INT{nullable}]; INPUT r: TABLE[y: INT{nullable}];
    STEP j = JOIN {{ TYPE INNER; ON left.x == right.y; {guarantee} }}
    STEP s = SELECT {{ COLUMNS {select}; }} OUTPUT o: TABLE;
    {extra} FLOW {{ l -> j.left; r -> j.right; j -> s -> o; {flow} }} }}'''


def data(left=(2, 1, 2), right=(1, 2)):
    return {'l': pl.DataFrame({'x': left}, schema={'x': pl.Int64}),
            'r': pl.DataFrame({'y': right}, schema={'y': pl.Int64})}


def execute(source, frames, passes, rt=None, collect=True):
    scope = {'__name__': 'test_joins'}
    exec(compile_program(parse(source), passes=passes), scope)
    out = scope['PIPELINES']['p'](rt or PolarsRuntime(), frames)
    return {n: f.collect() for n, f in out.items()} if collect else out


def module(source, passes=DEFAULT):
    return build_ir(parse(source), passes)[1]


class JoinTests(unittest.TestCase):
    def equivalent(self, source, frames, passes=DEFAULT):
        before, after = execute(source, frames, ()), execute(source, frames, passes)
        self.assertEqual(before.keys(), after.keys())
        for name in before:
            self.assertEqual(before[name].schema, after[name].schema)
            self.assertTrue(before[name].equals(after[name]), (before[name], after[name]))
        return after

    def failure(self, source, frames, code):
        messages = []
        for passes in ((), ('joins',), DEFAULT, ('muertos', 'joins', 'muertos')):
            with self.assertRaises(ExecutionError) as exc:
                # No collect del cliente: la obligación debe ejecutarse de todos modos.
                execute(source, frames, passes, collect=False)
            self.assertIn(code, str(exc.exception))
            messages.append(str(exc.exception))
        self.assertEqual(len(set(messages)), 1)

    def test_elimination_proof_and_real_equivalence(self):
        source = program()
        m = module(source)
        j = next(n for n in m.pipelines[0].nodes if n.name == 'j')
        self.assertEqual(j.kind, 'CHECK_JOIN')
        self.assertEqual({ref.node for _, ref in j.inputs}, {'l', 'r'})
        proof, = m.join_rewrites
        self.assertEqual((proof.node, proof.consumers, proof.origin), ('j', ('s',), ('j',)))
        self.assertEqual(source[proof.declaration_span.start:proof.declaration_span.end], 'VERIFY MANY_TO_ONE;')
        self.assertIn('unique_right_key', proof.obligations)
        self.assertIn('CHECK_JOIN', proof.verification)
        out = self.equivalent(source, data())
        self.assertEqual(out['o']['x'].to_list(), [2, 1, 2])
        generated = compile_program(parse(source))
        self.assertNotIn('.join(', generated)
        self.assertIn('verify_many_to_one', generated)
        self.assertIn('.join(', compile_program(parse(source), passes=()))

    def test_duplicate_missing_and_null_contracts(self):
        for frames, code in [(data(right=(1, 2, 2)), 'E_JOIN_UNIQUE'),
                             (data(right=(1,)), 'E_JOIN_REFERENCE'),
                             (data(left=(None, 1)), 'E_JOIN_NULL'),
                             (data(right=(None, 1, 2)), 'E_JOIN_NULL'),
                             (data(left=(None,), right=(None,)), 'E_JOIN_NULL')]:
            with self.subTest(code=code, frames=frames):
                self.failure(program(), frames, code)
        self.failure(program(nullable=''), data(left=(None,)), 'E_NULL')
        self.failure(program(nullable=''), data(right=(None,)), 'E_NULL')
        for side in ('left', 'right'):
            source = program().replace('x: INT?' if side == 'left' else 'y: INT?',
                                       'x: INT' if side == 'left' else 'y: INT')
            self.equivalent(source, data())

    def test_empty_inputs(self):
        for l, r in [((), ()), ((), (1, 2)), ((1,), (1,))]:
            self.equivalent(program(), data(l, r))
        self.failure(program(), data((1,), ()), 'E_JOIN_REFERENCE')
        self.failure(program(), data((), (1, 1)), 'E_JOIN_UNIQUE')
        self.failure(program(), data((), (None,)), 'E_JOIN_NULL')

    def test_key_types_static_and_physical(self):
        source = program().replace('y: INT?', 'y: STRING?')
        result = analyze(source)
        self.assertFalse(result.ok)
        self.assertEqual(result.diagnostics[0].code, 'E_TYPE')
        span = result.diagnostics[0].span
        self.assertEqual(source[span.start:span.end], 'left.x == right.y')
        self.assertEqual(result.artifacts['ir_before'].status, 'available')
        self.assertEqual(result.artifacts['python'].status, 'blocked')
        with self.assertRaises(CompileError):
            compile_program(parse(source))
            connector = source.replace('INPUT r: TABLE[y: INT?]',
                'SOURCE r: TABLE[y: INT?] = CSV(file: \"absent.csv\")')
            self.assertTrue(analyze(connector).ok)
            compile_program(parse(connector))
        frames = data()
        frames['r'] = frames['r'].cast({'y': pl.Int32})
        self.failure(program(), frames, 'E_JOIN_KEY_TYPE')

    def test_all_consumers_and_right_key_are_observable(self):
        for source in [program('y'), program('x, y'),
                       program(extra='OUTPUT all_rows: TABLE;', flow='j -> all_rows;'),
                       program(extra='STEP t = SELECT { COLUMNS y; } OUTPUT other: TABLE;',
                               flow='j -> t -> other;'),
                       program().replace('STEP s = SELECT { COLUMNS x; }', '').replace('j -> s -> o;', 'j -> o;'),
                       program(extra='SINK sink = CSV(file: "all.csv");', flow='j -> sink;')]:
            with self.subTest(source=source):
                self.assertFalse(module(source).join_rewrites)
        # La clave derecha y las columnas no clave cuentan por igual.
        source = program('z').replace('y: INT?', 'y: INT?, z: INT?')
        self.assertFalse(module(source).join_rewrites)
        frames = data(); frames['r'] = frames['r'].with_columns(pl.lit(4).alias('z'))
        self.equivalent(source, frames)

    def test_shared_branches_and_projection_frontier(self):
        source = program(extra='STEP t = SELECT { COLUMNS x; } OUTPUT other: TABLE; OUTPUT raw: TABLE;',
                         flow='j -> t -> other; r -> raw;')
        self.assertEqual(module(source).join_rewrites[0].consumers, ('s', 't'))
        self.equivalent(source, data())
        self.failure(source, data(right=(1, 2, 2)), 'E_JOIN_UNIQUE')

    def test_transformations_checked_on_exact_join_inputs(self):
        # Garantía posterior a cualquier operación: jamás se hereda de su entrada.
        for operation, right, expected in [
            ('SELECT { COLUMNS y; }', (1, 2), None),
            ('RENAME { y AS k; }', (1, 2), None),
            ('DERIVE { k = y; }', (1, 2, 2), 'E_JOIN_UNIQUE'),
            ('FILTER { WHERE y > 1; }', (1, 2), 'E_JOIN_REFERENCE'),
            ('DISTINCT { COLUMNS y; }', (1, 2, 2), None),
            ('AGGREGATE { GROUP_BY y; COUNT() AS n; }', (1, 2, 2), None),
            ('SORT { BY y DESC; }', (1, 2), None),
            ('FILL_NULL { y = 1; }', (None, 1, 2), 'E_JOIN_UNIQUE'),
            ('DROP_NULLS { COLUMNS y; }', (None, 1, 2), None),
        ]:
            source = program(extra=f'STEP t = {operation}').replace('r -> j.right;', 'r -> t -> j.right;')
            if operation.startswith(('RENAME', 'DERIVE')):
                source = source.replace('right.y', 'right.k')
            with self.subTest(operation=operation):
                self.assertTrue(module(source).join_rewrites)
                if expected:
                    self.failure(source, data(right=right), expected)
                else:
                    self.equivalent(source, data(right=right))

    def test_downstream_operations_and_conservative_barriers(self):
        for operation in ['RENAME { x AS k; }', 'DERIVE { k = x + 1; }',
                          'FILTER { WHERE x > 1; }', 'DISTINCT { COLUMNS x; }',
                          'AGGREGATE { SUM(x) AS total; }', 'SORT { BY x; }',
                          'FILL_NULL { x = 0; }', 'DROP_NULLS { COLUMNS x; }']:
            source = program(extra=f'STEP t = {operation}').replace('s -> o;', 's -> t -> o;')
            self.assertTrue(module(source).join_rewrites)
            self.equivalent(source, data())
            # Sin frontera de proyección, se conserva el JOIN aunque se pudiera
            # calcular liveness con mayor precisión en una versión futura.
            barrier = source.replace('STEP s = SELECT { COLUMNS x; }', '').replace('j -> s -> t', 'j -> t')
            self.assertFalse(module(barrier).join_rewrites)

    def test_output_contract_and_use_ports(self):
        source = program().replace('OUTPUT o: TABLE;', 'OUTPUT o: TABLE[x: INT];')
        self.equivalent(source, data())
        source = program().replace('OUTPUT o: TABLE;', 'USE child AS c; OUTPUT o: TABLE;').replace(
            's -> o;', 's -> c.i; c.o -> o;') + '''
        PIPELINE child { INPUT i: TABLE[x: INT?]; OUTPUT o: TABLE[x: INT]; FLOW { i -> o; } }'''
        self.assertTrue(module(source).join_rewrites)
        self.equivalent(source, data())
        direct = source.replace('STEP s = SELECT { COLUMNS x; }', '').replace('j -> s -> c.i;', 'j -> c.i;').replace(
            'TABLE[x: INT?]; OUTPUT o: TABLE[x: INT]', 'TABLE[x: INT?, y: INT?]; OUTPUT o: TABLE')
        self.assertFalse(module(direct).join_rewrites)
        self.equivalent(direct, data())
        # JOIN dentro del pipeline llamado: los bindings se comprueban primero.
        child = program().replace('PIPELINE p', 'PIPELINE child')
        parent = '''PIPELINE p { INPUT l: TABLE[x: INT?]; INPUT r: TABLE[y: INT?]; USE child AS c;
        OUTPUT o: TABLE; FLOW { l -> c.l; r -> c.r; c.o -> o; } }'''
        self.equivalent(parent + child, data())

    def test_unknown_schemas_insufficient_and_unsupported_guarantees(self):
        self.assertFalse(module(program(guarantee='')).join_rewrites)
        source = program().replace('INPUT r: TABLE[y: INT?]', 'SOURCE r = CSV(file: "absent.csv")')
        self.assertTrue(analyze(source).ok)
        self.assertFalse(module(source).join_rewrites)
        for replacement in ['TYPE LEFT', 'TYPE RIGHT', 'TYPE FULL']:
            source = program().replace('TYPE INNER', replacement)
            result = analyze(source)
            self.assertEqual(result.diagnostics[0].code, 'E_JOIN_GUARANTEE')
            span = result.diagnostics[0].span
            self.assertEqual(source[span.start:span.end], 'VERIFY MANY_TO_ONE;')
        source = program().replace('right.y;', 'right.y AND left.x == right.y;')
        self.assertEqual(analyze(source).diagnostics[0].code, 'E_JOIN_GUARANTEE')

    def test_dead_preserves_unobserved_obligation_and_dependencies(self):
        source = program(extra='OUTPUT raw: TABLE;', flow='l -> raw;').replace('j -> s -> o;', 'l -> s -> o;')
        self.assertFalse(module(source).join_rewrites)
        self.assertIn('j', [n.name for n in module(source).pipelines[0].nodes])
        self.failure(source, data(right=(1, 1)), 'E_JOIN_UNIQUE')
        # Lectura derecha, contrato y obligación permanecen tras CHECK_JOIN + muertos.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'right.csv'
            path.write_text('y\n1\n2\n')
            source = program().replace('INPUT r: TABLE[y: INT?]',
                f'SOURCE r: TABLE[y: INT?] = CSV(file: "{path}")')
            rt = PolarsRuntime()
            with patch.object(rt, 'source', wraps=rt.source) as read:
                self.equivalent(source, {'l': data()['l']})
                execute(source, {'l': data()['l']}, DEFAULT, rt)
                read.assert_called_once()
            path.unlink()
            self.failure(source, {'l': data()['l']}, 'E_SOURCE')

    def test_materialized_validation_snapshots(self):
        # Modificar el archivo después de invocar el pipeline no invalida la prueba.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'right.csv'; path.write_text('y\n1\n2\n')
            source = program().replace('INPUT r: TABLE[y: INT?]',
                f'SOURCE r: TABLE[y: INT?] = CSV(file: "{path}")')
            for passes in ((), DEFAULT):
                outputs = execute(source, {'l': data()['l']}, passes, collect=False)
                path.write_text('y\n1\n1\n')
                self.assertEqual(outputs['o'].collect()['x'].to_list(), [2, 1, 2])
                path.write_text('y\n1\n2\n')

    def test_scalar_comparisons_and_reversed_on(self):
        from decimal import Decimal
        for dtype, values in [(pl.String, ['b', 'a', 'b']),
                              (pl.Float64, [float('nan'), 1., float('nan')]),
                              (pl.Decimal(20, 2), [Decimal('0.10'), Decimal('2.30'), Decimal('0.10')])]:
            name = 'STRING' if dtype == pl.String else 'DECIMAL'
            source = program().replace('INT?', name + '?').replace('left.x == right.y', 'right.y == left.x')
            frames = {'l': pl.DataFrame({'x': values}, schema={'x': dtype}),
                      'r': pl.DataFrame({'y': values[:2]}, schema={'y': dtype})}
            self.equivalent(source, frames)
            frames['r'] = pl.concat([frames['r'], frames['r']])
            self.failure(source, frames, 'E_JOIN_UNIQUE')

    def test_right_nonkey_contract_and_lazy_expression_errors_survive(self):
        source = program().replace('y: INT?', 'y: INT?, z: STRING')
        frames = data()
        frames['r'] = frames['r'].with_columns(pl.lit(None, dtype=pl.String).alias('z'))
        self.failure(source, frames, 'E_NULL')
        frames['r'] = frames['r'].with_columns(pl.lit(7).alias('z'))
        self.failure(source, frames, 'E_TYPE')
        # Un cálculo derecho no proyectado se materializa de verdad.
        source = program().replace('INPUT r: TABLE[y: INT?]', 'SOURCE r = CSV(file: "unused.csv")')
        source = source.replace('STEP s = SELECT', 'STEP t = DERIVE { bad = LOWER(y); } STEP s = SELECT')
        source = source.replace('r -> j.right;', 'r -> t -> j.right;')
        rt = PolarsRuntime()
        with patch.object(rt, 'source', return_value=data()['r'].lazy()):
            for passes in ((), DEFAULT):
                with self.assertRaises(ExecutionError):
                    execute(source, {'l': data()['l']}, passes, rt)

    def test_all_pass_orders_and_api_parity_no_io(self):
        source = program()
        for order in permutations(DEFAULT):
            with self.subTest(order=order):
                self.equivalent(source, data(), order)
        result = analyze(source)
        self.assertEqual(result.artifacts['python'].data, compile_program(parse(source)))
        self.assertEqual(result.artifacts['ir_after'].data['module']['join_rewrites'][0]['node'], 'j')
        self.assertFalse(module(source, ()).join_rewrites)
        with patch.object(PolarsRuntime, 'source', side_effect=AssertionError('IO')), \
             patch.object(Path, 'read_text', side_effect=AssertionError('IO')), \
             patch('builtins.open', side_effect=AssertionError('IO')):
            self.assertTrue(analyze(source).ok)
            compile_program(parse(source))
            connector = source.replace('INPUT r: TABLE[y: INT?]',
                'SOURCE r: TABLE[y: INT?] = CSV(file: \"absent.csv\")')
            self.assertTrue(analyze(connector).ok)
            compile_program(parse(connector))
