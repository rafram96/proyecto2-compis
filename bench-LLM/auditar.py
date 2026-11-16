"""Comprueba la integridad de una corrida completa sin volver a generar código."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

import benchmark as b


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corrida', type=Path)
    parser.add_argument('--solo-respuestas', action='store_true',
                        help='Verifica la evidencia versionada sin exigir logs raw locales.')
    args = parser.parse_args()
    root = args.corrida
    run = json.loads((root/'run.json').read_text(encoding='utf-8'))
    data = json.loads((root/'evaluacion.json').read_text(encoding='utf-8'))
    rows = [json.loads(line) for line in (root/'respuestas.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    prompts = {(r['task_id'], r['language']): r for r in map(json.loads, (root/'prompts.jsonl').read_text(encoding='utf-8').splitlines())}
    languages = data['manifest'].get('languages', ['capybara', 'python'])
    expected_pairs = {(t['task_id'], lang, 1) for t in data['manifest']['selected'] for lang in languages}
    actual_pairs = {(r['task_id'], r['language'], r['sample']) for r in rows}
    if actual_pairs != expected_pairs or len(rows) != len(actual_pairs):
        raise ValueError('Hay respuestas duplicadas o pendientes.')
    sessions, tools, versions, models = set(), Counter(), set(), set()
    evaluated = {(r['task_id'],r['language'],r['sample']):r for r in data['results']}
    for row in rows:
        key = row['task_id'], row['language']
        text = prompts[key]['prompt']
        if hashlib.sha256(text.encode()).hexdigest() != row['prompt_sha256']:
            raise ValueError(f'Hash del prompt incorrecto: {key}')
        if hashlib.sha256((run['wrapper']+text).encode()).hexdigest() != row['submitted_prompt_sha256']:
            raise ValueError(f'Hash del envío incorrecto: {key}')
        evaluated_row = evaluated.get((row['task_id'], row['language'], row['sample']))
        if evaluated_row is None or evaluated_row['code'] != row['code']:
            raise ValueError(f'La evaluación no conserva la respuesta original: {key}')
        if args.solo_respuestas:
            sessions.add(row['session_id'])
            models.update(row['actual_models'])
            continue
        if not (root/'raw').is_dir():
            parser.error('Los logs raw son locales. Usar --solo-respuestas para la evidencia versionada.')
        raw = json.loads((root/'raw'/f'{key[0]}-{key[1]}-1.json').read_text(encoding='utf-8'))
        if raw['payload'].get('result', '') != row['code']:
            raise ValueError(f'La respuesta fue modificada: {key}')
        if raw['payload'].get('sessionId') != row['session_id']:
            raise ValueError(f'Sesión incorrecta: {key}')
        sessions.add(row['session_id'])
        tools.update(e['tool_name'] for e in raw['tool_events'])
        versions.update(re.findall(r'Junie ([\d.]+ \([\d.]+\))', raw['stderr']))
        models.update(row['actual_models'])
    if len(sessions) != len(rows) or None in sessions:
        raise ValueError('Las sesiones no son independientes.')
    evaluated_pairs = {(r['task_id'], r['language'], r['sample']) for r in data['results']}
    if evaluated_pairs != expected_pairs or not data['paired_samples']:
        raise ValueError('La evaluación no corresponde a la selección completa.')
    audit = {'scope': 'saved_responses' if args.solo_respuestas else 'full_raw',
             'raw_files': 0 if args.solo_respuestas else len(rows), 'languages': languages,
             'response_pairs_unique': True, 'session_ids_unique': True,
             'prompts_verified': True, 'original_responses_verified': True,
             'models': sorted(models), 'cli_versions': sorted(versions),
             'tool_counts': dict(tools),
             'external_tool_attempts': None if args.solo_respuestas else sum(n for name,n in tools.items() if name not in {'answer','submit'}),
             'generation_errors': sum(bool(r.get('generation_error')) for r in rows)}
    b.dump(root/('VERIFICACION.json' if args.solo_respuestas else 'AUDITORIA.json'), audit)
    print(json.dumps(audit, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
