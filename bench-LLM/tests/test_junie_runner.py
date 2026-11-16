import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import benchmark as b
import junie_runner as runner


class JunieRunnerTests(unittest.TestCase):
    def test_command_disables_external_context_and_uses_cmd(self):
        command = runner.command(Path('C:/isolated/work'), Path('C:/isolated/control'), 'junie-lite')
        self.assertEqual(command[:4], ['cmd.exe', '/d', '/s', '/c'])
        text = command[4]
        for flag in ['--config-default-locations=false', '--mcp-default-locations=false',
                     '--skill-default-locations=false', '--command-default-location=false',
                     '--agent-default-location=false', '--model-default-locations=false']:
            self.assertIn(flag, text)
        self.assertNotIn('--resume', text)
        self.assertNotIn(str(b.ROOT), text)

    def test_raw_answer_is_preserved_and_tool_attempt_is_not_accepted(self):
        request = {'task_id': 'multi_001', 'language': 'capybara', 'prompt': 'prompt', 'prompt_sha256': 'abc'}
        raw = {'payload': {'result': 'original response', 'sessionId': 'session1',
                           'llmUsage': [{'model': 'actual-model', 'calls': 1}]},
               'exit_code': 0, 'timeout': False, 'duration_s': 1, 'blocked_tool_attempts': 1}
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, 'invoke', return_value=raw):
            _, row = runner.collect_one(request, 0, 'junie-lite', 10, Path(temporary))
            self.assertEqual(row['code'], 'original response')
            self.assertEqual(row['actual_models'], ['actual-model'])
            self.assertEqual(row['generation_error'], 'tool_attempt_during_prompt_only_generation')
            self.assertTrue((Path(temporary)/'raw/multi_001-capybara-1.json').exists())

    def test_generation_error_is_not_executed_or_counted_correct(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            b.dump(root/'manifest.json', {'upstream_commit': b.verify_upstream()['commit'],
                                          'selected': [{'task_id': 'multi_001'}]})
            row = {'task_id': 'multi_001', 'language': 'python', 'sample': 1, 'code': '',
                   'generation_error': 'provider_error'}
            (root/'responses.jsonl').write_text(json.dumps(row)+'\n', encoding='utf-8')
            with patch.object(b, 'execute', side_effect=AssertionError('No debe ejecutarse')):
                results = b.evaluate(root/'responses.jsonl', root/'results.json', root/'manifest.json', 1)
            self.assertEqual(results[0]['status'], 'generation_error')
            self.assertFalse(results[0]['pass_all'])

    def test_index_error_retry_requires_no_llm_response_or_usage(self):
        error = {'errors': ['index-session-123.tmp -> index.jsonl']}
        self.assertTrue(runner.index_error(error))
        self.assertFalse(runner.index_error({**error, 'result': 'generated code'}))
        self.assertFalse(runner.index_error({**error, 'llmUsage': [{'calls': 1}]}))
        self.assertFalse(runner.index_error({'errors': ['rate_limit']}))

    def test_startup_retry_keeps_failed_artifact(self):
        request = {'task_id': 'multi_001', 'language': 'python', 'prompt': 'prompt', 'prompt_sha256': 'abc'}
        failure = {'payload': {'errors': ['index-session-123.tmp -> index.jsonl']},
                   'exit_code': 1, 'timeout': False, 'duration_s': 1, 'blocked_tool_attempts': 0}
        success = {**failure, 'payload': {'result': 'original program', 'llmUsage': [{'model': 'm'}]}, 'exit_code': 0}
        with tempfile.TemporaryDirectory() as temporary, patch.object(runner, 'invoke', side_effect=[failure, success]) as invoke:
            _, row = runner.collect_one(request, 0, 'junie-lite', 10, Path(temporary))
            self.assertEqual(invoke.call_count, 2)
            self.assertEqual(row['code'], 'original program')
            self.assertNotIn('generation_error', row)
            self.assertTrue((Path(temporary)/'raw/multi_001-python-1.startup-error.json').exists())


if __name__ == '__main__':
    unittest.main()
