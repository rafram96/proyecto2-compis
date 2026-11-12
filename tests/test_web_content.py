"""Las expectativas publicadas se comprueban con el núcleo, nunca con semántica TS."""
import json
import unittest
from unittest.mock import patch

from etl_dsl import analyze
from web.scripts.gen_content import build_content, serialized, validate_slugs, DEST, ROOT


class WebContentTests(unittest.TestCase):
    def test_generated_content_is_current_and_explicit(self):
        content = build_content()
        self.assertEqual(DEST.read_text(encoding="utf-8"), serialized())
        self.assertEqual(len(content['examples']), 5)
        self.assertEqual(len(content['articles']), 6)
        for kind in content.values():
            validate_slugs(kind)
        for example in content['examples']:
            self.assertEqual(example['code'], (ROOT / example['source']).read_text(encoding="utf-8"))
            self.assertTrue(example['requirements'])
            self.assertTrue(example['expectedText'])
        for article in content['articles']:
            self.assertTrue(article['body'])
            self.assertNotIn('Propuesta_DSL', json.dumps(article))
            self.assertNotIn('plan_desarrollo', json.dumps(article))

    def test_slugs_reject_duplicates_and_paths(self):
        for slugs in [['a', 'a'], ['../privado'], [''], ['con espacio'], ['%2F']]:
            with self.subTest(slugs=slugs), self.assertRaises(ValueError):
                validate_slugs([{'slug': s} for s in slugs])

    def test_all_published_programs_match_compiler_expectations_without_datasets(self):
        for example in build_content()['examples']:
            for passes in (None, []):
                with self.subTest(slug=example['slug'], passes=passes):
                    # El compilador no debe consultar datasets durante este recorrido.
                    with patch('builtins.open', side_effect=AssertionError('IO de datos durante compilación')):
                        result = analyze(example['code'], filename=example['name'], passes=passes).to_dict()
                    expected = example['expectation']
                    self.assertEqual(result['contract_version'], '4')
                    self.assertEqual(result['ok'], expected['ok'])
                    self.assertEqual(result['pipeline_count'], expected['pipelines'])
                    if not expected['ok']:
                        diagnostic = result['diagnostics'][0]
                        self.assertEqual(diagnostic['code'], expected['diagnostic'])
                        span = diagnostic['span']
                        self.assertEqual(example['code'][span['start']:span['end']], example['correction']['from'])
                        continue
                    self.assertEqual(result['diagnostics'], [])
                    module = result['artifacts']['ir_after']['data']['module']
                    if passes == []:
                        self.assertEqual(module['range_rewrites'], [])
                        self.assertEqual(module['join_rewrites'], [])
                    else:
                        if 'rangeActions' in expected:
                            self.assertEqual([r['action'] for r in module['range_rewrites']], expected['rangeActions'])
                        if 'joinRewrites' in expected:
                            self.assertEqual(len(module['join_rewrites']), expected['joinRewrites'])
                    if example['slug'] == 'join-verificado':
                        self.assertIn('verify_many_to_one', result['artifacts']['python']['data'])
                    if example['slug'] == 'riesgo-crediticio':
                        text = result['artifacts']['ir_after']['data']['text']
                        self.assertIn('SAFE_DIVIDE(debt, income)', text)
                        self.assertIn('COALESCE(segment, "UNKNOWN")', text)
                        self.assertIn('USE', text)
                    if example['slug'] == 'ventas':
                        text = result['artifacts']['ir_after']['data']['text']
                        self.assertIn('amount > 10' if passes is None else '2 * 5', text)
                        self.assertIn('FILTER', result['artifacts']['ir_after']['data']['text'])
                        self.assertIn('AGGREGATE', result['artifacts']['ir_after']['data']['text'])
                        self.assertIn('SORT', result['artifacts']['ir_after']['data']['text'])

    def test_invalid_exercise_correction_compiles_and_all_article_programs_are_valid(self):
        content = build_content()
        for example in content['examples']:
            if 'correction' in example:
                correction = example['correction']
                self.assertEqual(example['code'].count(correction['from']), 1)
                source = example['code'].replace(correction['from'], correction['to'])
                self.assertTrue(analyze(source).ok)
        for article in content['articles']:
            example = next(e for e in content['examples'] if e['slug'] == article['program'])
            self.assertTrue(analyze(example['code']).ok)

    def test_referenced_sections_fail_closed_when_documentation_changes(self):
        from web.scripts import gen_content
        real_manifest = gen_content.manifest
        def changed(name):
            entries = real_manifest(name)
            if name == 'articles':
                entries[0]['sources'][0]['sections'] = ['Sección inexistente']
            return entries
        with patch.object(gen_content, 'manifest', side_effect=changed), self.assertRaises(KeyError):
            build_content()

    def test_studio_view_links_match_the_published_views(self):
        from web.scripts.gen_content import STUDIO_LINK
        import re
        slugs = {'resultado', 'tokens', 'arbol', 'ast', 'flow', 'ir', 'esquemas', 'python', 'ejecucion'}
        allowed = set(re.search(r'vista=\(\?:([a-z|]+)\)', STUDIO_LINK.pattern)[1].split('|'))
        self.assertEqual(allowed, slugs)
        for slug in slugs:
            self.assertTrue(STUDIO_LINK.fullmatch(f'/estudio?vista={slug}'))
        for url in ['/estudio?vista=otra', '/estudio?vista=ir&x=1', '/estudiox']:
            self.assertIsNone(STUDIO_LINK.fullmatch(url))
        for article in build_content()['articles']:
            for url in re.findall(r'\]\((/estudio[^)]*)\)', article['body']):
                self.assertTrue(STUDIO_LINK.fullmatch(url), url)
        # Las fuentes TypeScript no se copian a la imagen Docker; donde existen, deben coincidir.
        view, body = ROOT / 'web/src/workspace/view.ts', ROOT / 'web/src/components/ArticleBody.tsx'
        if view.exists() and body.exists():
            table = re.search(r'VIEW_SLUGS[^{]*\{(.*?)\};', view.read_text(encoding='utf-8'), re.S)[1]
            self.assertEqual(set(re.findall(r'\w+: "(\w+)"', table)) | {'ejecucion'}, slugs)
            self.assertIn('EXECUTION_SLUG = "ejecucion"', view.read_text(encoding='utf-8'))
            rendered = re.search(r'vista=\(([a-z|]+)\)', body.read_text(encoding='utf-8'))[1]
            self.assertEqual(set(rendered.split('|')), slugs)
