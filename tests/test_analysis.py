from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from etl_dsl import analyze, compile_program, parse, scan
from etl_dsl.analysis import ARTIFACTS, FORMATS, artifacts_for_format, format_diagnostics, format_output
from etl_dsl.ast import to_dict
from etl_dsl.backend import build_ir
from etl_dsl.ir import format_module
from etl_dsl.main import main
from etl_dsl.passes import DEFAULT


SOURCE = """PIPELINE p {
 INPUT data: TABLE[id: INT, x: DECIMAL?];
 STEP f1 = FILTER { WHERE x > 2 * 3; }
 STEP f2 = FILTER { WHERE id > 0; }
 OUTPUT out: TABLE;
 FLOW { data -> f1 -> f2 -> out; }
}"""


class AnalysisTests(unittest.TestCase):
    def test_contract_preserves_ast_ir_spans_and_versions(self):
        result = analyze(SOURCE, filename="memory.etl")
        payload = json.loads(json.dumps(result.to_dict()))
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["contract_version"], "4")
        self.assertEqual(payload["offset_encoding"], "unicode-codepoints")
        self.assertEqual(len(payload["source_hash"]), 64)
        self.assertEqual(payload["artifacts"]["ast"]["data"], to_dict(parse(SOURCE)))
        for name in ARTIFACTS:
            self.assertEqual(payload["artifacts"][name]["status"], "available")
        fused = next(n for n in payload["artifacts"]["ir_after"]["data"]["module"]["pipelines"][0]["nodes"]
                     if n["kind"] == "FILTER")
        self.assertEqual(fused["origin"], ["f1", "f2"])
        self.assertEqual(fused["span"]["line"], 3)
        self.assertEqual(payload["applied_passes"], list(DEFAULT))

    def test_text_outputs_match_existing_compiler(self):
        result = analyze(SOURCE, filename="memory.etl")
        before, after = build_ir(parse(SOURCE))
        self.assertEqual(format_output(result, "python"), compile_program(parse(SOURCE), filename="memory.etl"))
        self.assertIn(format_module(before), format_output(result, "ir"))
        self.assertIn(format_module(after), format_output(result, "ir"))
        self.assertEqual(json.loads(format_output(result, "tokens")), [to_dict(t) for t in scan(SOURCE)])

    def test_only_check_does_not_optimize_or_generate(self):
        with patch("etl_dsl.analysis.optimize", side_effect=AssertionError("unexpected pass")), \
             patch("etl_dsl.analysis.generate", side_effect=AssertionError("unexpected codegen")):
            result = analyze(SOURCE, artifacts=())
        self.assertTrue(result.ok)
        self.assertTrue(all(a.status == "not_requested" for a in result.artifacts.values()))
        self.assertEqual(result.applied_passes, ())

    def test_ir_before_does_not_run_passes_or_codegen(self):
        with patch("etl_dsl.analysis.optimize", side_effect=AssertionError("unexpected pass")), \
             patch("etl_dsl.analysis.generate", side_effect=AssertionError("unexpected codegen")):
            result = analyze(SOURCE, artifacts=("ir_before",))
        self.assertEqual(result.artifacts["ir_before"].status, "available")
        self.assertEqual(result.artifacts["ir_after"].status, "not_requested")
        self.assertEqual(result.applied_passes, ())

    def test_syntax_failure_keeps_tokens_but_not_a_fake_ast(self):
        result = analyze(SOURCE[:-1], filename="incomplete.etl")
        self.assertFalse(result.ok)
        self.assertEqual(result.diagnostics[0].phase, "syntax")
        self.assertEqual(result.artifacts["tokens"].status, "available")
        self.assertTrue(all(result.artifacts[n].status == "blocked" for n in ARTIFACTS if n != "tokens"))
        self.assertEqual(result.diagnostics[0].span.start, len(SOURCE) - 1)
        self.assertEqual(result.diagnostics[0].span.end, len(SOURCE) - 1)

    def test_lexical_failure_is_consistent_for_all_selections(self):
        source = "PIPELINE p { @"
        full, check = analyze(source), analyze(source, artifacts=())
        self.assertEqual(full.diagnostics, check.diagnostics)
        diag = full.diagnostics[0]
        self.assertEqual(diag.code, "E_LEXICAL")
        self.assertEqual(diag.phase, "lexical")
        self.assertEqual(source[diag.span.start:diag.span.end], "@")
        self.assertEqual(full.artifacts["tokens"].status, "blocked")

    def test_validation_failure_preserves_ast_and_all_diagnostics(self):
        source = SOURCE.replace("id > 0", "x == NULL").replace("f2 -> out", "f2 -> missing")
        result = analyze(source, filename="C:/logical/programa.etl")
        self.assertFalse(result.ok)
        self.assertIn("E_NULL_COMPARISON", [d.code for d in result.diagnostics])
        self.assertIn("E_UNKNOWN_NODE", [d.code for d in result.diagnostics])
        for name in ("tokens", "tree", "ast"):
            self.assertEqual(result.artifacts[name].status, "available")
        for name in ("ir_before", "ir_after", "python"):
            self.assertEqual(result.artifacts[name].status, "blocked")
        self.assertEqual(result.to_dict()["diagnostics"][0]["filename"], "C:/logical/programa.etl")
        self.assertIn("Program", format_output(result, "ast"))

    def test_backend_failure_retains_ir_and_has_structured_location(self):
        source = 'PIPELINE p { SOURCE x = EXCEL(file: "missing.xlsx"); OUTPUT o: TABLE; FLOW { x -> o; } }'
        result = analyze(source, filename="conector.etl")
        self.assertFalse(result.ok)
        self.assertEqual(result.artifacts["ir_after"].status, "available")
        self.assertEqual(result.artifacts["python"].status, "blocked")
        diag = result.diagnostics[0]
        self.assertEqual((diag.code, diag.phase), ("E_CONNECTOR", "backend"))
        self.assertEqual(source[diag.span.start:diag.span.end], 'EXCEL(file: "missing.xlsx")')

    def test_qualifier_error_is_not_parsed_from_exception_text(self):
        result = analyze(SOURCE.replace("id > 0", "left.id > 0"))
        self.assertEqual(result.diagnostics[0].code, "E_QUALIFIER")
        self.assertEqual(result.diagnostics[0].span.line, 4)

    def test_pass_selection_o0_and_order(self):
        result = analyze(SOURCE, passes=())
        self.assertEqual(result.passes, ())
        self.assertEqual(result.applied_passes, ())
        self.assertEqual(result.artifacts["ir_before"].data, result.artifacts["ir_after"].data)
        self.assertNotIn("después", format_output(result, "ir"))
        result = analyze(SOURCE, passes=("filtros", "constantes"))
        self.assertEqual(result.applied_passes, ("filtros", "constantes"))

    def test_invalid_options_are_caller_errors(self):
        for kwargs in ({"passes": ["magic"]}, {"artifacts": ["symbols"]},
                       {"passes": "filtros"}, {"artifacts": "ast"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                analyze(SOURCE, **kwargs)

    def test_unicode_multiline_range_and_decimal_json(self):
        source = SOURCE.replace("WHERE id > 0", 'WHERE "😀" == "é" AND x == NULL')
        result = analyze(source)
        diag = next(d for d in result.diagnostics if d.code == "E_NULL_COMPARISON")
        self.assertEqual(source[diag.span.start:diag.span.end], "x == NULL")
        self.assertEqual(diag.span.column, len(source.splitlines()[3].split("x == NULL")[0]) + 1)
        multiline = analyze(SOURCE.replace("id > 0", "x\n == NULL"))
        diag = multiline.diagnostics[0]
        self.assertEqual(diag.span.end_line, diag.span.line + 1)
        decimal = analyze(SOURCE.replace("2 * 3", "0.1234567890123456789"), artifacts=("ast",))
        self.assertIn('"0.1234567890123456789"', json.dumps(decimal.to_dict()))

    def test_no_source_connector_or_output_io(self):
        source = 'PIPELINE p { SOURCE x = CSV(file: "absent.csv"); SINK o = PARQUET(file: "never.parquet"); FLOW { x -> o; } }'
        # Calentar únicamente la gramática antes de prohibir cualquier lectura/escritura.
        parse(SOURCE)
        with patch("builtins.open", side_effect=AssertionError("unexpected IO")), \
             patch.object(Path, "read_text", side_effect=AssertionError("unexpected read")), \
             patch.object(Path, "write_text", side_effect=AssertionError("unexpected write")):
            result = analyze(source, filename="/nonexistent/directory/demo.etl")
        self.assertTrue(result.ok)

    def test_import_does_not_load_native_runtime_dependencies(self):
        code = "from etl_dsl import analyze; import sys; assert not {'polars', 'duckdb', 'etl_dsl.runtime'} & sys.modules.keys()"
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_cli_formats_and_diagnostics_use_same_analysis(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "programa.etl"
            path.write_text(SOURCE, encoding="utf-8")
            for fmt in FORMATS:
                with self.subTest(fmt=fmt):
                    out = StringIO()
                    args = [str(path), "--format", fmt]
                    if fmt == "python":
                        args += ["--output", str(Path(temp) / "generated")]
                    with redirect_stdout(out):
                        self.assertEqual(main(args), 0)
                    result = analyze(SOURCE, filename=str(path), base_dir=temp, artifacts=artifacts_for_format(fmt))
                    expected = format_output(result, fmt)
                    if fmt == "python":
                        self.assertEqual((Path(temp) / "generated/programa.py").read_text(), expected)
                    else:
                        self.assertEqual(out.getvalue(), expected)
            broken = SOURCE.replace("id > 0", "x == NULL")
            path.write_text(broken, encoding="utf-8")
            err = StringIO()
            with redirect_stderr(err):
                self.assertEqual(main([str(path), "--format", "check"]), 1)
            self.assertEqual(err.getvalue(), format_diagnostics(analyze(broken, filename=str(path)), broken))


if __name__ == "__main__":
    unittest.main()
