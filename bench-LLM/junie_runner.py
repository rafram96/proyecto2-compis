"""Genera respuestas con Junie por CMD, en sesiones nuevas con herramientas bloqueadas."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import argparse
import hashlib
from importlib.metadata import version
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import threading
import time

import benchmark as b

INDEX_LOCK = threading.Lock()

WRAPPER = """This is a code-generation benchmark, not a project-editing task.
All required language documentation and the task are provided below.
Do not read files, run commands, search the web, delegate to other agents, or edit
the project. No tools are needed. Do not test or repair the program.
Include the COMPLETE requested program in your final answer / submit solution_summary,
inside ONE fenced code block. A description of a solution is not sufficient.
Do not claim you created or tested files. Return the complete code as text.

"""
PS_GUARD = '''$payload = [Console]::In.ReadToEnd()
$eventData = $payload | ConvertFrom-Json
[IO.File]::AppendAllText((Join-Path $PSScriptRoot 'tool-events.jsonl'), $payload.Trim() + [Environment]::NewLine)
if ($eventData.tool_name -in @('submit', 'answer')) {
    Write-Output '{"decision":"allow"}'
} else {
    Write-Output '{"decision":"deny","reason":"This benchmark permits only the final text answer. Filesystem, terminal, network and delegation tools are blocked."}'
}
'''


def command(work, control, model):
    args = ['junie', '--skip-update-check', '--config-default-locations=false',
            '--config-location=' + str(control / 'config.json'),
            '--mcp-default-locations=false', '--skill-default-locations=false',
            '--command-default-location=false', '--agent-default-location=false',
            '--model-default-locations=false', '--extensions-default-location=' + str(control / 'extensions'),
            '--guidelines-filename=NO_BENCHMARK_GUIDELINES.md',
            '--project=' + str(work), '--cache-dir=' + str(control / 'cache'),
            '--allowed-tools=answer', '--act-as-interactive', '--agent-mode=chat',
            '--max-steps=4', '--output-format=json', '--input-format=text', '--model=' + model]
    return ['cmd.exe', '/d', '/s', '/c', subprocess.list2cmdline(args)]


def invoke(prompt, model, timeout):
    # No se incluyen rutas del repositorio, manifiestos privados ni otros prompts.
    root = Path(tempfile.mkdtemp(prefix='junie-generation-'))
    work, control = root / 'workspace', root / 'control'
    work.mkdir()
    (control / 'extensions').mkdir(parents=True)
    hook = control / 'deny-tools.ps1'
    hook.write_text(PS_GUARD, encoding='utf-8')
    b.dump(control / 'config.json', {'hooks': {'PreToolUse': [{'hooks': [{
        'type': 'command', 'command': f'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{hook}"',
        'timeout': 5, 'blockOnError': True, 'strictJsonOutput': True}]}]}})
    env = os.environ.copy()
    env['JAVA_TOOL_OPTIONS'] = (env.get('JAVA_TOOL_OPTIONS', '') +
        ' -Djavax.net.ssl.trustStoreType=Windows-ROOT -Dfile.encoding=UTF-8'
        ' -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8').strip()
    started = time.perf_counter()
    process = subprocess.Popen(command(work, control, model), stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=work,
                               text=True, encoding='utf-8', errors='replace', env=env)
    timed_out = False
    try:
        stdout, stderr = process.communicate(prompt, timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       capture_output=True, check=False)
        stdout, stderr = process.communicate(timeout=20)
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        payload = {'errors': ['Junie no devolvió un objeto JSON válido.']}
    events = []
    if (control / 'tool-events.jsonl').exists():
        events = [json.loads(line) for line in (control / 'tool-events.jsonl').read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    forbidden = [e for e in events if e.get('tool_name') not in {'answer', 'submit'}]
    return {'payload': payload, 'stdout': stdout, 'stderr': stderr,
            'exit_code': process.returncode, 'timeout': timed_out,
            'duration_s': round(time.perf_counter() - started, 3),
            'tool_events': events, 'blocked_tool_attempts': len(forbidden),
            'workspace': str(root)}


def collect_one(request, index, model, timeout, output):
    submitted = WRAPPER + request['prompt']
    raw = invoke(submitted, model, timeout)
    artifact = output / 'raw' / f"{request['task_id']}-{request['language']}-1.json"
    startup_retries = 0
    if index_error(raw['payload']):
        b.dump(artifact.with_suffix('.startup-error.json'), raw)
        # Solo se repite un fallo local anterior a cualquier respuesta/uso del LLM.
        with INDEX_LOCK:
            raw = invoke(submitted, model, timeout)
        startup_retries = 1
    b.dump(artifact, raw)
    payload = raw['payload']
    errors = payload.get('errors', [])
    code = payload.get('result', '')
    error = None
    if raw['timeout']:
        error = 'generation_timeout'
    elif raw['exit_code'] != 0 or errors:
        error = 'junie_error: ' + '; '.join(map(str, errors))
    elif raw['blocked_tool_attempts']:
        error = 'tool_attempt_during_prompt_only_generation'
    elif not code:
        error = 'empty_response'
    row = {'task_id': request['task_id'], 'language': request['language'], 'sample': 1,
           'model': model, 'actual_models': [u.get('model') for u in payload.get('llmUsage', [])],
           'prompt_sha256': request['prompt_sha256'],
           'submitted_prompt_sha256': hashlib.sha256(submitted.encode()).hexdigest(),
           'code': code, 'session_id': payload.get('sessionId'),
           'generation_seconds': raw['duration_s'], 'blocked_tool_attempts': raw['blocked_tool_attempts'],
           'llm_usage': payload.get('llmUsage', []), 'startup_retries': startup_retries}
    if error:
        row['generation_error'] = error
    return index, row


def index_error(payload):
    return (not payload.get('result') and not payload.get('llmUsage')
            and any('index-session-' in str(e) and 'index.jsonl' in str(e)
                    for e in payload.get('errors', [])))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preparado', type=Path, default=b.HERE / 'preparado')
    parser.add_argument('--salida', type=Path, required=True)
    parser.add_argument('--model', default='junie-lite')
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--timeout', type=float, default=180)
    parser.add_argument('--tareas', nargs='+')
    parser.add_argument('--evaluar', action='store_true')
    parser.add_argument('--continuar-desde', type=Path,
                        help='Conserva respuestas previas y genera solo las pendientes en otra carpeta.')
    args = parser.parse_args()
    if os.name != 'nt' or not shutil.which('junie'):
        parser.error('Se requiere Windows con junie disponible en CMD.')
    if args.workers < 1 or args.workers > 4 or args.timeout <= 0:
        parser.error('Usar de 1 a 4 workers y un timeout positivo.')
    if args.salida.exists():
        parser.error('La carpeta de salida ya existe; usar otra para conservar los intentos originales.')
    b.verify_upstream()
    requests = [json.loads(line) for line in (args.preparado / 'prompts.jsonl').read_text(encoding='utf-8').splitlines() if line.strip()]
    if args.tareas:
        requests = [r for r in requests if r['task_id'] in args.tareas]
    if not requests:
        parser.error('No hay solicitudes seleccionadas.')
    for row in requests:
        if hashlib.sha256(row['prompt'].encode()).hexdigest() != row['prompt_sha256']:
            parser.error('Un prompt no coincide con su hash.')
    retained = []
    startup_failures = []
    if args.continuar_desde:
        previous_run = json.loads((args.continuar_desde / 'run.json').read_text(encoding='utf-8'))
        if previous_run['model_alias'] != args.model or previous_run['wrapper'] != WRAPPER:
            parser.error('El modelo o las instrucciones no coinciden con la corrida previa.')
        for line in (args.continuar_desde / 'respuestas.jsonl').read_text(encoding='utf-8').splitlines():
            row = json.loads(line)
            if row.get('generation_error') and not row.get('llm_usage') and 'index-session-' in row['generation_error'] and 'index.jsonl' in row['generation_error']:
                startup_failures.append(row)
            else:
                retained.append(row)
        hashes = {(r['task_id'], r['language']): r['prompt_sha256'] for r in requests}
        if any(hashes.get((r['task_id'], r['language'])) != r['prompt_sha256'] for r in retained):
            parser.error('Los prompts no coinciden con la corrida previa.')
    args.salida.mkdir(parents=True)
    if args.continuar_desde:
        shutil.copytree(args.continuar_desde / 'raw', args.salida / 'raw')
        b.dump(args.salida / 'previous-run.json', previous_run)
        b.dump(args.salida / 'startup-failures.json', startup_failures)
    shutil.copyfile(args.preparado / 'manifest.json', args.salida / 'manifest.json')
    manifest = json.loads((args.salida / 'manifest.json').read_text(encoding='utf-8'))
    (args.salida / 'prompts.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in requests), encoding='utf-8')
    metadata = {'started_at': datetime.now(timezone.utc).isoformat(), 'model_alias': args.model,
                'samples_per_task_language': 1, 'planned_generations': len(requests),
                'wrapper': WRAPPER, 'tools_policy': 'PreToolUse denies all except answer/submit; fail closed',
                'windows_root_certificates': True, 'workers': args.workers,
                'temperature': 'not exposed by this Junie CLI; provider default',
                'max_steps': 4, 'external_integrations_disabled': True,
                'order_seed': 2026, 'retained_generations': len(retained),
                'comparison_languages': manifest.get('languages', ['capybara', 'python']),
                'polars_version': version('polars'),
                'continued_from': str(args.continuar_desde) if args.continuar_desde else None}
    b.dump(args.salida / 'run.json', metadata)
    random.Random(2026).shuffle(requests)
    planned = len(requests)
    done = {(r['task_id'], r['language']) for r in retained}
    requests = [r for r in requests if (r['task_id'], r['language']) not in done]
    # Se procesan lotes pequeños; un fallo del servicio detiene nuevos envíos.
    responses = args.salida / 'respuestas.jsonl'
    completed, failed = len(retained), False
    with responses.open('w', encoding='utf-8') as stream, ThreadPoolExecutor(max_workers=args.workers) as pool:
        for row in retained:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
        stream.flush()
        for start in range(0, len(requests), args.workers):
            pending = [pool.submit(collect_one, row, start+i, args.model, args.timeout, args.salida)
                       for i, row in enumerate(requests[start:start+args.workers])]
            for future in as_completed(pending):
                _, row = future.result()
                stream.write(json.dumps(row, ensure_ascii=False) + '\n')
                stream.flush()
                completed += 1
                print(f"[{completed}/{planned}] {row['task_id']} {row['language']}: {row.get('generation_error', 'respuesta guardada')}", flush=True)
                if row.get('generation_error', '').startswith(('junie_error', 'generation_timeout')):
                    failed = True
            if failed:
                break
    metadata.update({'finished_at': datetime.now(timezone.utc).isoformat(),
                     'completed_generations': completed, 'complete': completed == planned,
                     'stopped_on_service_error': failed})
    b.dump(args.salida / 'run.json', metadata)
    if args.evaluar and completed:
        b.evaluate(responses, args.salida / 'evaluacion.json', args.salida / 'manifest.json', 10)
    print('Corrida guardada:', args.salida, flush=True)


if __name__ == '__main__':
    main()
