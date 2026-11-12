from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest

from etl_dsl import parse
from etl_dsl.ir import lower, schema_text
from etl_dsl.main import main
from etl_dsl.typecheck import check


ROOT = Path(__file__).resolve().parents[1]
INPUT = "INPUT data: TABLE[id: INT, x: DECIMAL?, s: STRING?, ok: BOOL, d: DATE?];"


def analyze(source):
    return check(lower(parse(source)))


def steps(*operations, output="OUTPUT result: TABLE;"):
    """Pipeline lineal: data -> s0 -> s1 -> ... -> result."""
    names = [f"s{i}" for i in range(len(operations))]
    body = " ".join(f"STEP {name} = {op}" for name, op in zip(names, operations))
    chain = " -> ".join(["data", *names, "result"])
    return f"PIPELINE p {{ {INPUT} {body} {output} FLOW {{ {chain}; }} }}"


def schema(source, node="result", pipeline="p"):
    info = analyze(source)
    assert not info.diagnostics, [d.message for d in info.diagnostics]
    return schema_text(info.schemas[pipeline, node])


def codes(source):
    return [d.code for d in analyze(source).diagnostics]


class InferenceTests(unittest.TestCase):
    def test_operations_propagate_types_and_nullability(self):
        source = steps("DROP_NULLS { COLUMNS x; }",
                       "FILL_NULL { s = \"?\"; }",
                       "DERIVE { y = x * 2; z = id + 1; r = x / id; t = UPPER(s); n = NULLIF(id, 0); }",
                       "SELECT { COLUMNS id, y, z, r, t, n; }")
        self.assertEqual(schema(source), "[id: INT, y: DECIMAL, z: INT, r: DECIMAL, t: STRING, n: INT?]")

    def test_expressions(self):
        source = steps("DERIVE { a = COALESCE(x, 0); b = COALESCE(x, id); c = x IS NULL; "
                       "e = SAFE_DIVIDE(id, 2); f = -id; g = NOT ok AND x > 1; }",
                       "SELECT { COLUMNS a, b, c, e, f, g; }")
        self.assertEqual(schema(source), "[a: DECIMAL, b: DECIMAL, c: BOOL, e: DECIMAL?, f: INT, g: BOOL?]")

    def test_aggregate(self):
        grouped = steps("AGGREGATE { GROUP_BY s; COUNT() AS n; SUM(id) AS total; AVG(x) AS avg; MAX(d) AS last; }")
        self.assertEqual(schema(grouped), "[s: STRING?, n: INT, total: INT, avg: DECIMAL?, last: DATE?]")
        # Sin GROUP_BY una entrada vacía produce NULL en SUM.
        self.assertEqual(schema(steps("AGGREGATE { SUM(id) AS total; }")), "[total: INT?]")

    def test_join_kinds(self):
        for kind, expected in [("INNER", "[id: INT, k: INT]"), ("LEFT", "[id: INT, k: INT?]"),
                               ("RIGHT", "[id: INT?, k: INT]"), ("FULL", "[id: INT?, k: INT?]")]:
            source = f"""PIPELINE p {{ INPUT a: TABLE[id: INT]; INPUT b: TABLE[k: INT];
                STEP j = JOIN {{ TYPE {kind}; ON left.id == right.k; }} OUTPUT o: TABLE;
                FLOW {{ a -> j.left; b -> j.right; j -> o; }} }}"""
            with self.subTest(kind=kind):
                self.assertEqual(schema(source, "o"), expected)

    def test_rename_sort_distinct(self):
        source = steps("RENAME { id AS key; }", "SORT { BY key DESC; }", "DISTINCT { COLUMNS s, key; }")
        self.assertEqual(schema(source), "[s: STRING?, key: INT]")

    def test_use_outputs_and_typed_output(self):
        source = """PIPELINE p { INPUT data: TABLE[id: INT]; USE child AS c; OUTPUT o: TABLE;
              FLOW { data -> c.i; c.out -> o; } }
            PIPELINE child { INPUT i: TABLE[id: INT]; STEP d = DERIVE { y = id * 2; }
              OUTPUT out: TABLE[id: INT, y: DECIMAL]; FLOW { i -> d -> out; } }"""
        self.assertEqual(schema(source, "o"), "[id: INT, y: DECIMAL]")

    def test_unknown_schemas_are_not_errors(self):
        source = """PIPELINE p { SOURCE raw = CSV(file: "x.csv");
            STEP f = FILTER { WHERE amount > 0; } STEP g = AGGREGATE { GROUP_BY k; COUNT() AS n; AVG(v) AS m; }
            OUTPUT o: TABLE; FLOW { raw -> f -> g -> o; } }"""
        self.assertEqual(schema(source, "o"), "[k: ANY?, n: INT, m: DECIMAL?]")
        for name in ("credit_risk.etl", "duckdb.etl"):
            with self.subTest(name=name):
                self.assertEqual(analyze((ROOT / "input" / name).read_text(encoding="utf-8")).diagnostics, ())


class ErrorTests(unittest.TestCase):
    def test_error_codes(self):
        cases = {
            "FILTER { WHERE missing > 0; }": "E_COLUMN",
            "FILTER { WHERE x + 1; }": "E_TYPE",
            "FILTER { WHERE s > 1; }": "E_TYPE",
            "FILTER { WHERE d == \"2024-01-01\"; }": "E_TYPE",
            "FILTER { WHERE ok AND id; }": "E_TYPE",
            "FILTER { WHERE left.id > 0; }": "E_QUALIFIER",
            "DERIVE { y = s * 2; }": "E_TYPE",
            "DERIVE { y = -s; }": "E_TYPE",
            "DERIVE { y = LOWER(id); }": "E_TYPE",
            "DERIVE { y = COALESCE(s, 0); }": "E_TYPE",
            "DERIVE { x = 1; }": "E_DUPLICATE_COLUMN",
            "DERIVE { ID = 1; }": "E_AMBIGUOUS_COLUMNS",
            "FILL_NULL { s = 0; }": "E_TYPE",
            "FILL_NULL { missing = 0; }": "E_COLUMN",
            "AGGREGATE { SUM(s) AS t; }": "E_TYPE",
            "AGGREGATE { GROUP_BY missing; COUNT() AS n; }": "E_COLUMN",
            "SORT { BY missing; }": "E_COLUMN",
            "RENAME { id AS x; }": "E_AMBIGUOUS_COLUMNS",
            "SELECT { COLUMNS id, missing; }": "E_COLUMN",
            "DROP_NULLS { COLUMNS missing; }": "E_COLUMN",
        }
        for operation, code in cases.items():
            with self.subTest(operation=operation):
                self.assertEqual(codes(steps(operation)), [code])

    def test_join_errors(self):
        base = """PIPELINE p {{ INPUT a: TABLE[id: INT, s: STRING]; INPUT b: TABLE[k: STRING, s2: INT];
            STEP j = JOIN {{ TYPE INNER; ON {cond}; }} OUTPUT o: TABLE;
            FLOW {{ a -> j.left; b -> j.right; j -> o; }} }}"""
        self.assertEqual(codes(base.format(cond="left.id == right.k")), ["E_TYPE"])
        self.assertEqual(codes(base.format(cond="left.missing == right.k")), ["E_COLUMN"])
        self.assertEqual(codes(base.format(cond="left.s == right.k")), [])

    def test_contracts(self):
        self.assertEqual(codes(steps("SELECT { COLUMNS id; }", output="OUTPUT result: TABLE[id: STRING];")),
                         ["E_TYPE"])
        self.assertEqual(codes(steps("SELECT { COLUMNS id, x; }", output="OUTPUT result: TABLE[id: INT];")),
                         ["E_SCHEMA"])
        # INT cumple DECIMAL; la nulabilidad se verifica en ejecución.
        self.assertEqual(codes(steps("SELECT { COLUMNS id, x; }",
                                     output="OUTPUT result: TABLE[id: DECIMAL, x: DECIMAL];")), [])
        use = """PIPELINE p { INPUT data: TABLE[id: STRING]; USE child AS c; OUTPUT o: TABLE;
              FLOW { data -> c.i; c.out -> o; } }
            PIPELINE child { INPUT i: TABLE[id: INT]; OUTPUT out: TABLE; FLOW { i -> out; } }"""
        self.assertEqual(codes(use), ["E_TYPE"])

    def test_errors_are_reported_once_with_position(self):
        source = steps("DERIVE { y = missing + 1; }", "SELECT { COLUMNS y; }", "FILTER { WHERE y > 0; }")
        diagnostics = analyze(source).diagnostics
        # y queda con tipo desconocido: los pasos siguientes no repiten el error.
        self.assertEqual([d.code for d in diagnostics], ["E_COLUMN"])
        self.assertEqual(diagnostics[0].span.start, source.index("missing"))
        # Los errores independientes se reportan todos, en orden de aparición.
        independent = steps("FILTER { WHERE missing > 0; }", "DERIVE { y = s * 2; z = LOWER(id); }")
        self.assertEqual(codes(independent), ["E_COLUMN", "E_TYPE", "E_TYPE"])

    def test_cli_check_reports_type_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.etl"
            path.write_text(steps("FILTER { WHERE s > 1; }"), encoding="utf-8")
            stderr = StringIO()
            with redirect_stderr(stderr), redirect_stdout(StringIO()):
                self.assertEqual(main([str(path), "--format", "check"]), 1)
            self.assertIn("E_TYPE: No se puede comparar STRING con INT en s > 1.", stderr.getvalue())
            self.assertIn("1 error(es) de tipos", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
