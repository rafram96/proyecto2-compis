from pathlib import Path
import shutil
import tempfile
import unittest

from etl_dsl import ParseError, parse, parse_file, validate
from etl_dsl import ast as a
from etl_dsl.api import compile_source, run_source
from etl_dsl.ir import format_module, lower
from scripts.create_demo_data import create_demo_data


ROOT = Path(__file__).resolve().parents[1]

LINEAR = """PIPELINE p {
    FROM CSV(file: "orders.csv") AS TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?];
    FILL_NULL { amount = 0; }
    FILTER { WHERE amount > 0; }
    TO CSV(file: "out/validos.csv");
    AGGREGATE { GROUP_BY status; SUM(amount) AS total; }
    TO CSV(file: "out/resumen.csv");
}"""

# Lo mismo en forma de grafo, con los nombres que la forma lineal genera.
GRAPH = """PIPELINE p {
    SOURCE origen: TABLE[id: INT, customer_id: INT, amount: DECIMAL?, status: STRING?] = CSV(file: "orders.csv");
    STEP fill_null = FILL_NULL { amount = 0; }
    STEP filter = FILTER { WHERE amount > 0; }
    SINK destino = CSV(file: "out/validos.csv");
    STEP aggregate = AGGREGATE { GROUP_BY status; SUM(amount) AS total; }
    SINK destino_2 = CSV(file: "out/resumen.csv");
    FLOW {
        origen -> fill_null -> filter -> destino;
        filter -> aggregate -> destino_2;
    }
}"""


def codes(source):
    return [d.code for d in validate(parse(source))]


def edges(pipeline: a.Pipeline):
    return [(c.endpoints[0].name, c.endpoints[1].name) for c in pipeline.flow.connections]


class LinearFormTests(unittest.TestCase):
    def test_is_sugar_for_the_graph_form(self):
        linear, graph = parse(LINEAR), parse(GRAPH)
        self.assertTrue(linear.pipelines[0].linear)
        self.assertFalse(graph.pipelines[0].linear)
        self.assertEqual(validate(linear), ())
        self.assertEqual(format_module(lower(linear)), format_module(lower(graph)))

    def test_to_saves_and_the_chain_continues(self):
        pipeline = parse(LINEAR).pipelines[0]
        self.assertEqual(edges(pipeline), [("origen", "fill_null"), ("fill_null", "filter"),
                                           ("filter", "destino"), ("filter", "aggregate"),
                                           ("aggregate", "destino_2")])

    def test_named_steps_are_kept_and_generated_names_never_clash(self):
        source = """PIPELINE p {
            FROM CSV(file: "a.csv");
            STEP filter = FILTER { WHERE x > 1; }
            FILTER { WHERE x < 9; }
            STEP origen = SELECT { COLUMNS x; }
            TO CSV(file: "b.csv");
        }"""
        pipeline = parse(source).pipelines[0]
        self.assertEqual([d.name for d in pipeline.declarations],
                         ["origen_2", "filter", "filter_2", "origen", "destino"])
        self.assertEqual(codes(source), [])

    def test_spans_point_to_each_line(self):
        pipeline = parse(LINEAR).pipelines[0]
        self.assertEqual([d.span.line for d in pipeline.declarations], [2, 3, 4, 5, 6, 7])

    def test_must_end_with_to(self):
        source = """PIPELINE p {
            FROM CSV(file: "a.csv");
            TO CSV(file: "b.csv");
            FILTER { WHERE x > 1; }
        }"""
        issues = validate(parse(source))
        self.assertEqual([(d.code, d.span.line) for d in issues], [("E_LINEAR_END", 4)])

    def test_join_needs_the_graph_form(self):
        source = """PIPELINE p {
            FROM CSV(file: "a.csv");
            JOIN { TYPE INNER; ON left.id == right.id; }
            TO CSV(file: "b.csv");
        }"""
        self.assertEqual(codes(source), ["E_LINEAR_JOIN"])

    def test_input_and_output_ports(self):
        source = """PIPELINE limpia {
            FROM INPUT pedidos: TABLE[id: INT, amount: DECIMAL?];
            FILL_NULL { amount = 0; }
            TO OUTPUT limpios: TABLE[id: INT, amount: DECIMAL];
        }"""
        pipeline = parse(source).pipelines[0]
        self.assertEqual([type(d).__name__ for d in pipeline.declarations], ["Input", "Step", "Output"])
        self.assertEqual(edges(pipeline), [("pedidos", "fill_null"), ("fill_null", "limpios")])
        self.assertEqual(validate(parse(source)), ())

    def test_linear_pipeline_used_from_a_graph_pipeline(self):
        source = """PIPELINE limpia {
            FROM INPUT pedidos: TABLE[id: INT];
            FILTER { WHERE id > 0; }
            TO OUTPUT limpios: TABLE;
        }
        PIPELINE reporte {
            SOURCE crudos = CSV(file: "a.csv");
            USE limpia AS l;
            SINK salida = CSV(file: "b.csv");
            FLOW { crudos -> l.pedidos; l.limpios -> salida; }
        }"""
        self.assertEqual(codes(source), [])

    def test_generated_names_avoid_input_and_output_names(self):
        source = """PIPELINE p {
            FROM INPUT filter: TABLE[x: INT];
            FILTER { WHERE x > 1; }
            TO OUTPUT destino: TABLE;
        }"""
        self.assertEqual([d.name for d in parse(source).pipelines[0].declarations],
                         ["filter", "filter_2", "destino"])
        self.assertEqual(codes(source), [])

    def test_syntax_errors(self):
        for source in ['PIPELINE p { FROM CSV(file: "a.csv"); }',          # sin operaciones ni TO
                       'PIPELINE p { FILTER { WHERE x > 1; } TO CSV(); }',  # falta FROM
                       'PIPELINE p { FROM CSV(file: "a.csv"); SOURCE s = CSV(); TO CSV(); }',  # formas mezcladas
                       'PIPELINE p { FROM INPUT x; TO OUTPUT y: TABLE; }',  # INPUT exige esquema
                       'PIPELINE p { FROM CSV(file: "a.csv"); USE q AS u; TO CSV(); }']:  # USE no es lineal
            with self.subTest(source=source), self.assertRaises(ParseError) as caught:
                parse(source)
            self.assertEqual(caught.exception.diagnostic.code, "E_SYNTAX")

    def test_type_errors_point_to_the_linear_line(self):
        result = compile_source(LINEAR.replace("WHERE amount > 0", "WHERE amont > 0"))
        error = result["diagnostics"][0]
        self.assertEqual((error["code"], error["stage"], error["start"]["line"]), ("E_COLUMN", "types", 4))

    def test_example_program_is_valid(self):
        program = parse_file(ROOT / "input" / "pedidos_lineal.etl")
        self.assertTrue(program.pipelines[0].linear)
        self.assertEqual(validate(program), ())


class LinearRunTests(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp())
        create_demo_data(self.temp)

    def tearDown(self):
        shutil.rmtree(self.temp)

    def test_runs_like_the_graph_form(self):
        linear = run_source(LINEAR, base_dir=self.temp, root=self.temp)
        graph = run_source(GRAPH, base_dir=self.temp, root=self.temp)
        self.assertTrue(linear["ok"], linear["diagnostics"])
        self.assertEqual(linear["results"], graph["results"])
        self.assertEqual(set(linear["results"]["p"]), {"destino", "destino_2"})
        self.assertTrue((self.temp / "out" / "resumen.csv").exists())

    def test_example_program_runs(self):
        source = (ROOT / "input" / "pedidos_lineal.etl").read_text(encoding="utf-8")
        result = run_source(source, base_dir=self.temp, root=self.temp)
        self.assertTrue(result["ok"], result["diagnostics"])
        totals = result["results"]["resumen_pedidos"]["destino_2"]
        self.assertEqual([c["name"] for c in totals["columns"]], ["status", "pedidos", "total"])


if __name__ == "__main__":
    unittest.main()
