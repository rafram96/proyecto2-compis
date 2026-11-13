from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import unittest

import polars as pl

from etl_dsl import ast as a
from etl_dsl import compile_program, parse
from etl_dsl.backend import build_ir
from etl_dsl.ir import format_module, lower
from etl_dsl.main import main
from etl_dsl.passes import DEFAULT, fold, optimize
from etl_dsl.runtime import PolarsRuntime


ROOT = Path(__file__).resolve().parents[1]
DATA = {"id": pl.Int64, "x": pl.Float64, "s": pl.String}
ROWS = [(1, 5.0, "a"), (2, None, None), (3, 50.0, "b"), (4, -1.0, "a"), (5, 500.0, None)]

# Forma de grafo: el código muerto necesita una rama (d -> unused) que la forma lineal no tiene.
CHAIN = """PIPELINE p {
    INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?];
    STEP f1 = FILTER { WHERE TRUE AND x < 10 * 10; }
    STEP f2 = FILTER { WHERE s IS NOT NULL; }
    STEP f3 = FILTER { WHERE 1 < 2; }
    STEP d = DERIVE { y = x * (2 + 3); }
    STEP unused = SELECT { COLUMNS id; }
    OUTPUT result: TABLE;
    FLOW { data -> f1 -> f2 -> f3 -> d -> result; d -> unused; }
}"""


def module(source, passes=DEFAULT):
    return build_ir(parse(source), passes)[1]


def run(source, passes, rows=ROWS):
    namespace = {"__name__": "test_ir"}
    exec(compile(compile_program(parse(source), passes=passes), "generated.py", "exec"), namespace)
    data = pl.DataFrame(rows, schema=DATA, orient="row").lazy()
    out = namespace["PIPELINES"]["p"](PolarsRuntime(), {"data": data})
    return {name: frame.collect() for name, frame in out.items()}


def expr(text):
    source = f"PIPELINE p {{ FROM INPUT data: TABLE[x: INT?]; FILTER {{ WHERE {text}; }} TO OUTPUT o: TABLE; }}"
    return parse(source).pipelines[0].declarations[1].operation.predicate


class LoweringTests(unittest.TestCase):
    def test_nodes_follow_flow_in_topological_order(self):
        pipe = module(CHAIN, ()).pipelines[0]
        self.assertEqual([n.name for n in pipe.nodes], ["data", "f1", "f2", "f3", "d", "unused", "result"])
        self.assertEqual(pipe.nodes[1].input().node, "data")
        self.assertEqual([n.kind for n in pipe.nodes[:2]], ["INPUT", "FILTER"])

    def test_join_and_use_ports(self):
        program = parse((ROOT / "input" / "credit_risk.etl").read_text(encoding="utf-8"))
        ir = lower(program)
        report = {p.name: p for p in ir.pipelines}["order_report"]
        nodes = {n.name: n for n in report.nodes}
        self.assertEqual(nodes["joined"].input("left").port, "cleaned")
        self.assertEqual(nodes["joined"].input("right").node, "customer_keys")
        self.assertEqual(nodes["clean"].input("orders").node, "raw_orders")
        self.assertEqual(ir.defaults, ("credit_risk", "order_report"))

    def test_text_format(self):
        text = format_module(module(CHAIN, ()))
        self.assertIn("%f1     = FILTER(%data) { TRUE AND (x < (10 * 10)) }", text)
        self.assertIn("%result = OUTPUT(%d) { TABLE }", text)


class PassTests(unittest.TestCase):
    def test_constant_folding(self):
        cases = {"x > 2 * 3": "x > 6", "TRUE AND x > 1": "x > 1", "x > 1 OR FALSE": "x > 1",
                 "FALSE AND x > 1": "FALSE", "x IS NULL OR TRUE": "TRUE", "NOT (1 > 2)": "TRUE",
                 "\"a\" < \"b\"": "TRUE", "x > 1 / 2": "x > (1 / 2)", "x > -(3)": "x > -3"}
        from etl_dsl.ir import expr_text
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(expr_text(fold(expr(source))), expected)

    def test_chain_is_optimized(self):
        pipe = module(CHAIN).pipelines[0]
        self.assertEqual([n.name for n in pipe.nodes], ["data", "f2", "d", "result"])
        fused = pipe.nodes[1]
        self.assertEqual(fused.origin, ("f1", "f2"))
        self.assertIn("(x < 100) AND (s IS NOT NULL)", format_module(module(CHAIN)))
        self.assertIn("y = x * 5", format_module(module(CHAIN)))

    def test_filters_with_shared_producer_are_not_fused(self):
        source = """PIPELINE p { INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?];
            STEP f1 = FILTER { WHERE x > 0; } STEP f2 = FILTER { WHERE x < 9; }
            OUTPUT a: TABLE; OUTPUT b: TABLE;
            FLOW { data -> f1 -> f2 -> a; f1 -> b; } }"""
        names = [n.name for n in module(source).pipelines[0].nodes]
        self.assertIn("f1", names)
        self.assertIn("f2", names)

    def test_dead_code_keeps_inputs_and_use(self):
        source = """PIPELINE child { FROM INPUT i: TABLE[id: INT]; TO CSV(file: "x.csv"); }
            PIPELINE p { INPUT data: TABLE[id: INT]; USE child AS c; STEP gone = SELECT { COLUMNS id; }
            FLOW { data -> c.i; data -> gone; } }"""
        names = [n.name for n in module(source).pipelines[1].nodes]
        self.assertEqual(names, ["data", "c"])

    def test_single_passes_and_unknown(self):
        only = [n.name for n in module(CHAIN, ("codigo_muerto",)).pipelines[0].nodes]
        self.assertEqual(only, ["data", "f1", "f2", "f3", "d", "result"])
        with self.assertRaises(ValueError):
            optimize(lower(parse(CHAIN)), ("magia",))

    def test_optimized_results_equal_unoptimized(self):
        programs = [CHAIN, """PIPELINE p { FROM INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?];
            FILTER { WHERE NOT (x > 1 + 1) OR x IS NULL; }
            FILTER { WHERE FALSE OR s == "a"; }
            AGGREGATE { GROUP_BY s; SUM(x * 1) AS t; COUNT() AS n; }
            TO OUTPUT result: TABLE; }"""]
        for source in programs:
            with self.subTest(source=source[:40]):
                optimized, plain = run(source, DEFAULT), run(source, ())
                self.assertEqual(optimized.keys(), plain.keys())
                for name in plain:
                    self.assertTrue(optimized[name].equals(plain[name]), name)


class CliTests(unittest.TestCase):
    def test_ir_format_and_flags(self):
        path = str(ROOT / "demo" / "optimizaciones.etl")
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(main([path, "--format", "ir"]), 0)
        self.assertIn("// IR antes de optimizar", out.getvalue())
        self.assertIn("// grandes + pagadas", out.getvalue())
        out = StringIO()
        with redirect_stdout(out):
            self.assertEqual(main([path, "--format", "ir", "-O0"]), 0)
        self.assertNotIn("después", out.getvalue())
        for argv in (["-O0", "--pases", "filtros"], ["--pases", "magia"]):
            with self.subTest(argv=argv), redirect_stderr(StringIO()), self.assertRaises(SystemExit):
                main([path, "--format", "ir", *argv])


if __name__ == "__main__":
    unittest.main()
