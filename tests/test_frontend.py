from contextlib import redirect_stderr, redirect_stdout
from decimal import Decimal
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest

from etl_dsl import ParseError, parse, parse_file, parse_tree, validate
from etl_dsl import ast as a
from etl_dsl.__main__ import main


ROOT = Path(__file__).resolve().parents[1]


def program(operation="FILTER { WHERE id > 0; }"):
    return ("PIPELINE demo { FROM INPUT x: TABLE[id: INT, z: DECIMAL?]; "
            f"{operation} TO OUTPUT out: TABLE; }}")


def graph_program(operation="FILTER { WHERE id > 0; }"):
    """Forma de grafo, para probar FLOW: puertos, conexiones y ramas."""
    return ("PIPELINE demo { INPUT x: TABLE[id: INT, z: DECIMAL?]; "
            f"STEP y = {operation} OUTPUT out: TABLE; "
            "FLOW { x -> y -> out; } }")


class ParserTests(unittest.TestCase):
    def test_reference_and_duckdb_examples(self):
        for path, count in [(ROOT / "input/credit_risk.etl", 3),
                            (ROOT / "input/duckdb.etl", 1)]:
            with self.subTest(path=path):
                ast = parse_file(path)
                self.assertEqual(len(ast.pipelines), count)
                self.assertEqual(validate(ast), ())

    def test_schema_types_nullable_and_spans(self):
        source = """PIPELINE p {
 FROM INPUT x: TABLE[i: INT, d: DECIMAL?, s: STRING, b: BOOL, dt: DATE, ts: DATETIME?];
 TO OUTPUT y: TABLE;
}"""
        ast = parse(source)
        schema = ast.pipelines[0].declarations[0].schema
        self.assertEqual([f.type for f in schema.fields], list(a.ScalarType))
        self.assertEqual([f.nullable for f in schema.fields], [False, True, False, False, False, True])
        self.assertEqual(schema.fields[0].span.line, 2)
        self.assertEqual(source[schema.span.start:schema.span.end],
                         "TABLE[i: INT, d: DECIMAL?, s: STRING, b: BOOL, dt: DATE, ts: DATETIME?]")
        self.assertIsNone(ast.pipelines[0].declarations[1].schema.fields)

    def test_precedence_and_associativity(self):
        ast = parse(program("FILTER { WHERE NOT id + 2 * 3 >= 7 AND z IS NOT NULL OR FALSE; }"))
        expr = ast.pipelines[0].declarations[1].operation.predicate
        self.assertEqual(expr.operator, "OR")
        self.assertEqual(expr.left.operator, "AND")
        self.assertEqual(expr.left.left.operator, "NOT")
        comparison = expr.left.left.operand
        self.assertEqual(comparison.operator, ">=")
        self.assertEqual(comparison.left.operator, "+")
        self.assertEqual(comparison.left.right.operator, "*")
        self.assertEqual(expr.left.right.operator, "IS NOT NULL")
        expr = parse(program("DERIVE { v = 10 - 3 - 2; }")).pipelines[0].declarations[1].operation.assignments[0].expression
        self.assertEqual(expr.left.operator, "-")
        self.assertEqual(expr.right.value, 2)

    def test_parentheses_and_unary_minus(self):
        expr = parse(program("DERIVE { v = -(id + 1) / -2; }")).pipelines[0].declarations[1].operation.assignments[0].expression
        self.assertEqual(expr.operator, "/")
        self.assertEqual(expr.left.operand.operator, "+")
        self.assertEqual(expr.right.operator, "-")

    def test_literal_values_and_connector_arguments(self):
        source = r'''PIPELINE p {
 FROM DUCKDB(file: "a\\b.duckdb", threshold: -1.23456789012345678901234567890123456789, flag: TRUE, empty: NULL);
 TO OUTPUT out: TABLE;
}'''
        connector = parse(source).pipelines[0].declarations[0].connector
        self.assertEqual(connector.arguments[0].value.value, r"a\b.duckdb")
        self.assertEqual(connector.arguments[1].value.value, Decimal("-1.23456789012345678901234567890123456789"))
        self.assertIs(connector.arguments[2].value.value, True)
        self.assertIsNone(connector.arguments[3].value.value)
        json.dumps(a.to_dict(parse(source)))

    def test_all_operations(self):
        operations = [
            "FILTER { WHERE id == 1 OR id != 2 AND z <= 4; }",
            "SELECT { COLUMNS id, z; }",
            "DERIVE { lower = LOWER(UPPER(TRIM(\" x \"))); c = COALESCE(z, NULLIF(id, 0)); d = SAFE_DIVIDE(id, z); }",
            "AGGREGATE { GROUP_BY id; SUM(z) AS s; AVG(z) AS a; MIN(z) AS lo; MAX(z) AS hi; COUNT() AS n; COUNT(z) AS nz; }",
            "AGGREGATE { COUNT() AS n; }",
            "SORT { BY id, z DESC; }",
            "DISTINCT { COLUMNS id; }",
            "RENAME { id AS key; z AS value; }",
            "FILL_NULL { z = 0; }",
            "DROP_NULLS { COLUMNS z; }",
        ]
        for operation in operations:
            with self.subTest(operation=operation):
                self.assertEqual(validate(parse(program(operation))), ())

    def test_keyword_prefix_in_column_names(self):
        self.assertEqual(validate(parse(program("DERIVE { v = LOWERcase + COALESCE_value; }"))), ())

    def test_joins(self):
        for kind in ("INNER", "LEFT", "RIGHT", "FULL"):
            source = f'''PIPELINE p {{
 INPUT a: TABLE[id: INT]; INPUT b: TABLE[key: INT];
 STEP j = JOIN {{ TYPE {kind}; ON left.id == right.key AND right.key == left.id; }}
 OUTPUT o: TABLE; FLOW {{ a -> j.left; b -> j.right; j -> o; }}
}}'''
            ast = parse(source)
            self.assertEqual(validate(ast), ())
            self.assertEqual(ast.pipelines[0].declarations[2].operation.kind, kind)

    def test_syntax_errors(self):
        for source in ("", "pipeline p {}", program().replace("WHERE", "where"),
                       program().replace("id > 0;", "id > 0"),
                       program().replace("id > 0", "id > 0 > 1"),
                       program().replace("TABLE[id: INT, z: DECIMAL?]", "TABLE[]"),
                       program('DERIVE { v = "bad\\q"; }'),
                       graph_program().replace("FLOW { x -> y -> out; }", "FLOW {}"),
                       program().replace("FROM INPUT", "FROM")):
            with self.subTest(source=source), self.assertRaises(ParseError):
                parse(source)

    def test_error_location_and_eof(self):
        with self.assertRaises(ParseError) as caught:
            parse("PIPELINE p {\n @", filename="broken.etl")
        self.assertEqual(caught.exception.diagnostic.span.line, 2)
        self.assertEqual(caught.exception.diagnostic.span.column, 2)
        self.assertIn("broken.etl:2:2", str(caught.exception))
        with self.assertRaises(ParseError) as caught:
            parse(program()[:-1] + "\n")
        self.assertEqual(caught.exception.diagnostic.span.line, 2)
        self.assertEqual(caught.exception.diagnostic.span.column, 1)


class ValidationTests(unittest.TestCase):
    def codes(self, source):
        return {issue.code for issue in validate(parse(source))}

    def test_null_comparisons_and_function_arity(self):
        for expr in ("z == NULL", "NULL != z", "z >= NULL", "(NULL) < z"):
            self.assertIn("E_NULL_COMPARISON", self.codes(program(f"FILTER {{ WHERE {expr}; }}")))
        for expr in ("LOWER()", "TRIM(id, z)", "COALESCE(z)", "NULLIF(z)", "SAFE_DIVIDE()"):
            self.assertIn("E_ARITY", self.codes(program(f"DERIVE {{ v = {expr}; }}")))
        self.assertIn("E_ARITY", self.codes(program("AGGREGATE { SUM() AS n; }")))

    def test_duplicates(self):
        cases = [program() + program(),
                 program().replace("id: INT", "id: INT, id: INT"),
                 program("DERIVE { v = 1; v = 2; }"),
                 program("AGGREGATE { GROUP_BY id; COUNT() AS id; }"),
                 program("RENAME { id AS v; z AS v; }"),
                 program("SELECT { COLUMNS id, id; }"),
                 program().replace("OUTPUT out", "OUTPUT x"),
                 'PIPELINE p { FROM CSV(file: "a", file: "b"); TO OUTPUT o: TABLE; }']
        for source in cases:
            with self.subTest(source=source):
                self.assertIn("E_DUPLICATE", self.codes(source))

    def test_invalid_flow(self):
        for flow, code in [
            ("x -> missing -> out;", "E_UNKNOWN_NODE"),
            ("x.port -> y -> out;", "E_PORT"),
            ("x -> y.left; y -> out;", "E_PORT"),
            ("x -> y -> out; out -> y;", "E_PORT"),
            ("x -> out;", "E_INCOMING"),
            ("x -> y; x -> y; y -> out;", "E_DUPLICATE_EDGE"),
            ("x -> y -> y -> out;", "E_CYCLE"),
            ("y -> out;", "E_UNUSED_INPUT"),
        ]:
            source = graph_program().replace("x -> y -> out;", flow)
            with self.subTest(flow=flow):
                self.assertIn(code, self.codes(source))

    def test_fanout(self):
        source = graph_program().replace("OUTPUT out: TABLE;", "OUTPUT out: TABLE; OUTPUT other: TABLE;")
        source = source.replace("x -> y -> out;", "x -> y -> out; y -> other;")
        self.assertEqual(validate(parse(source)), ())

    def test_use_forward_reference_ports_and_recursion(self):
        child = "PIPELINE child { FROM INPUT i: TABLE[id: INT]; TO OUTPUT o: TABLE; }"
        parent = '''PIPELINE parent { SOURCE s = CSV(file: "s.csv");
 USE child AS c; OUTPUT o: TABLE; FLOW { s -> c.i; c.o -> o; } }'''
        self.assertEqual(validate(parse(parent + child)), ())
        for replacement in ("s -> c.o", "s -> c", "s -> c.bad"):
            self.assertIn("E_PORT", self.codes(parent.replace("s -> c.i", replacement) + child))
        self.assertIn("E_UNKNOWN_PIPELINE", self.codes(parent))
        recursive = parent.replace("USE child AS c", "USE parent AS c")
        self.assertIn("E_CYCLE", self.codes(recursive))

    def test_join_missing_port_and_wrong_condition(self):
        source = '''PIPELINE p {
 INPUT a: TABLE[id: INT]; STEP j = JOIN { TYPE LEFT; ON left.id == left.id; }
 OUTPUT o: TABLE; FLOW { a -> j.left; j -> o; } }'''
        self.assertTrue({"E_JOIN_CONDITION", "E_INCOMING"} <= self.codes(source))

    def test_cli_formats_and_failure_status(self):
        for fmt in ("check", "ast", "tree"):
            out = StringIO()
            with redirect_stdout(out):
                self.assertEqual(main([str(ROOT / "input/duckdb.etl"), "--format", fmt]), 0)
            self.assertTrue(out.getvalue())
            if fmt == "ast":
                self.assertEqual(json.loads(out.getvalue())["node"], "Program")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.etl"
            for source, code in [("PIPELINE", "E_SYNTAX"), (program("FILTER { WHERE id == NULL; }"), "E_NULL_COMPARISON")]:
                path.write_text(source, encoding="utf-8")
                out = StringIO()
                with redirect_stderr(out):
                    self.assertEqual(main([str(path)]), 1)
                self.assertIn(code, out.getvalue())


if __name__ == "__main__":
    unittest.main()
