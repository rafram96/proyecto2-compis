from contextlib import redirect_stderr, redirect_stdout
import importlib.util
from io import StringIO
import json
from pathlib import Path
import tempfile
import unittest

from etl_dsl import analyze
from etl_dsl.analysis import FORMATS, artifacts_for_format, format_diagnostics, format_output


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cauce_studio", ROOT / "web/src/compiler/studio.py")
studio = importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)


class WebBridgeTests(unittest.TestCase):
    def test_all_formats_match_core_for_examples_o0_and_errors(self):
        paths = (ROOT / "web/scripts/programs/ventas.etl", ROOT / "input/credit_risk.etl",
                 ROOT / "web/scripts/programs/pendientes.etl")
        for path in paths:
            source = path.read_text(encoding="utf-8")
            for passes in (None, [], ["filtros", "constantes"]):
                for fmt in FORMATS:
                    with self.subTest(name=path.name, fmt=fmt, passes=passes):
                        core = analyze(source, filename=path.name, passes=passes,
                                       artifacts=artifacts_for_format(fmt))
                        bridge = studio.compile_etl(source, path.name, fmt, passes, compact=False)
                        self.assertEqual(bridge["analysis"], core.to_dict())
                        self.assertEqual(bridge["ok"], core.ok)
                        self.assertEqual(bridge["out"], format_output(core, fmt) if core.ok else "")
                        self.assertEqual(bridge["err"], format_diagnostics(core, source))

    def test_bridge_never_overwrites_the_logical_filename_or_captures_stderr(self):
        source = (ROOT / "web/scripts/programs/ventas.etl").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "programa.etl"
            path.write_text("keep this content", encoding="utf-8")
            out, err = StringIO(), StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                result = studio.compile_etl(source, str(path), "python")
            self.assertTrue(result["ok"])
            self.assertEqual(path.read_text(), "keep this content")
            self.assertEqual((out.getvalue(), err.getvalue()), ("", ""))
            result = studio.compile_etl(source, str(Path(temp) / "missing/programa.etl"))
            self.assertTrue(result["ok"])
            self.assertFalse((Path(temp) / "missing").exists())

    def test_compact_presentation_retains_positions_and_portable_python(self):
        source = (ROOT / "web/scripts/programs/ventas.etl").read_text(encoding="utf-8")
        ast = studio.compile_etl(source, "ventas.etl", "ast")
        self.assertNotIn('"span"', ast["out"])
        self.assertIn("span", ast["analysis"]["artifacts"]["ast"]["data"])
        py = studio.compile_etl(source, "ventas.etl", "python")
        self.assertEqual(py["out"], py["analysis"]["artifacts"]["python"]["data"])
        self.assertNotIn(str(ROOT), json.dumps(py))

    def test_failure_keeps_structured_diagnostics_and_requested_artifacts(self):
        source = (ROOT / "web/scripts/programs/pendientes.etl").read_text(encoding="utf-8")
        result = studio.compile_etl(source, "C:/virtual/pendientes.etl", "ast")
        self.assertFalse(result["ok"])
        self.assertEqual(result["analysis"]["artifacts"]["ast"]["status"], "available")
        diagnostic = result["analysis"]["diagnostics"][0]
        self.assertEqual(diagnostic["filename"], "C:/virtual/pendientes.etl")
        self.assertEqual(diagnostic["code"], "E_NULL_COMPARISON")
        span = diagnostic["span"]
        self.assertEqual(source[span["start"]:span["end"]], "status == NULL")

    def test_workspace_collects_all_views_with_partial_artifacts(self):
        valid = (ROOT / "web/scripts/programs/ventas.etl").read_text(encoding="utf-8")
        for source, expected in ((valid, True), (valid.replace("amount > 2 * 5", "missing > 0"), True),
                                 ("PIPELINE p {", False)):
            # La fuente CSV de ventas no tiene esquema: missing conserva conocimiento parcial.
            result = studio.compile_etl(source, "copia.etl", all_artifacts=True)
            self.assertEqual(set(result["views"]), set(FORMATS))
            self.assertEqual(result["analysis"]["contract_version"], "4")
            if expected:
                self.assertTrue(result["ok"])
                self.assertEqual(result["views"]["python"], result["analysis"]["artifacts"]["python"]["data"])
                self.assertTrue(all(a["status"] == "available" for a in result["analysis"]["artifacts"].values()))
            else:
                self.assertFalse(result["ok"])
                self.assertEqual(result["analysis"]["artifacts"]["tokens"]["status"], "available")
                self.assertTrue(result["views"]["tokens"])
                self.assertEqual(result["views"]["ast"], "")
        semantic = 'PIPELINE p { INPUT i: TABLE[x: INT]; STEP f = FILTER { WHERE missing > 0; } OUTPUT o: TABLE; FLOW { i -> f -> o; } }'
        result = studio.compile_etl(semantic, "parcial.etl", all_artifacts=True)
        self.assertFalse(result["ok"])
        self.assertIn("E_COLUMN", result["err"])
        self.assertTrue(result["views"]["ast"])
        self.assertTrue(result["views"]["ir"])
        self.assertEqual(result["analysis"]["artifacts"]["ir_after"]["status"], "blocked")
        self.assertEqual(result["views"]["python"], "")


if __name__ == "__main__":
    unittest.main()
