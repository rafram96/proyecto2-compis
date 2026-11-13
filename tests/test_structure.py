from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import tempfile
import unittest

from etl_dsl import ParseError, parse, scan
from etl_dsl import ast
from etl_dsl.main import main
from etl_dsl.token import Token
from etl_dsl.type import ScalarType
from etl_dsl.visitor import NodeVisitor, walk


SOURCE = """PIPELINE p {
 FROM INPUT x: TABLE[id: INT];
 DERIVE { value = id + 1; }
 TO OUTPUT o: TABLE;
}"""


class StructureTests(unittest.TestCase):
    def test_scanner_positions_comments_and_lexical_errors(self):
        source = '// ignored\nPIPELINE p { @'
        tokens = scan('// ignored\nPIPELINE p {')
        self.assertTrue(all(isinstance(token, Token) for token in tokens))
        self.assertEqual([token.lexeme for token in tokens], ['PIPELINE', 'p', '{'])
        self.assertEqual(tokens[0].span.line, 2)
        self.assertEqual(tokens[0].span.column, 1)
        for token in tokens:
            self.assertEqual(('// ignored\nPIPELINE p {')[token.span.start:token.span.end], token.lexeme)
        with self.assertRaises(ParseError) as caught:
            scan(source, filename='bad.etl')
        self.assertEqual(caught.exception.diagnostic.code, 'E_LEXICAL')
        self.assertEqual(caught.exception.diagnostic.span.line, 2)

    def test_visitor_dispatch_and_type_module(self):
        class Columns(NodeVisitor):
            def __init__(self):
                self.names = []

            def visit_Column(self, node):
                self.names.append(node.name)

        program = parse(SOURCE)
        visitor = Columns()
        visitor.visit(program)
        self.assertEqual(visitor.names, ['id'])
        self.assertIs(ast.ScalarType, ScalarType)
        self.assertEqual(program.pipelines[0].declarations[0].schema.fields[0].type, ScalarType.INT)
        self.assertIs(next(walk(program)), program)
        self.assertEqual(sum(isinstance(node, ast.Column) for node in walk(program)), 1)

    def test_default_main_input_output(self):
        with tempfile.TemporaryDirectory() as temp:
            previous = Path.cwd()
            try:
                os.chdir(temp)
                Path('input').mkdir()
                Path('input/demo.etl').write_text(SOURCE, encoding='utf-8')
                with redirect_stdout(StringIO()):
                    self.assertEqual(main([]), 0)
                output = Path('output/demo.py').read_text(encoding='utf-8')
                self.assertIn('Polars', output)
                compile(output, 'demo.py', 'exec')
            finally:
                os.chdir(previous)

    def test_batch_continues_after_error_and_preserves_subfolders(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'input'
            source.mkdir()
            (source / 'nested').mkdir()
            (source / 'a_invalid.etl').write_text('PIPELINE', encoding='utf-8')
            (source / 'b_valid.etl').write_text(SOURCE, encoding='utf-8')
            (source / 'nested/b_valid.etl').write_text(SOURCE, encoding='utf-8')
            (source / 'ignored.txt').write_text('not a program', encoding='utf-8')
            output = root / 'output'
            stderr = StringIO()
            with redirect_stdout(StringIO()), redirect_stderr(stderr):
                self.assertEqual(main([str(source), '-o', str(output)]), 1)
            self.assertIn('E_SYNTAX', stderr.getvalue())
            self.assertFalse((output / 'a_invalid.py').exists())
            self.assertTrue((output / 'b_valid.py').is_file())
            self.assertTrue((output / 'nested/b_valid.py').is_file())
            self.assertEqual(len(list(output.rglob('*.py'))), 2)

    def test_saved_tokens_tree_and_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'demo.etl'
            source.write_text(SOURCE, encoding='utf-8')
            for fmt, suffix in [('tokens', '.tokens.json'), ('tree', '.tree.txt')]:
                output = root / fmt
                with redirect_stdout(StringIO()):
                    self.assertEqual(main([str(source), '-o', str(output), '--format', fmt]), 0)
                content = (output / ('demo' + suffix)).read_text(encoding='utf-8')
                if fmt == 'tokens':
                    self.assertEqual(json.loads(content)[0]['lexeme'], 'PIPELINE')
                else:
                    self.assertIn('pipeline', content)
            with redirect_stdout(StringIO()):
                self.assertEqual(main([str(source), '-o', str(root / 'check'), '--format', 'check']), 0)
            self.assertFalse((root / 'check').exists())

    def test_missing_empty_and_unwritable_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            empty = root / 'empty'
            empty.mkdir()
            source = root / 'demo.etl'
            source.write_text(SOURCE, encoding='utf-8')
            blocked = root / 'blocked'
            blocked.write_text('a file, not a directory', encoding='utf-8')
            for args in ([str(root / 'missing')], [str(empty)], [str(source), '-o', str(blocked)]):
                with self.subTest(args=args), redirect_stderr(StringIO()):
                    self.assertEqual(main(args), 1)


if __name__ == '__main__':
    unittest.main()
