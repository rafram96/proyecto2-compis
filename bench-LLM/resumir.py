"""Resume una corrida evaluada de Junie sin alterar respuestas ni resultados."""
import argparse
from collections import Counter
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corrida', type=Path)
    args = parser.parse_args()
    data = json.loads((args.corrida / 'evaluacion.json').read_text(encoding='utf-8'))
    run = json.loads((args.corrida / 'run.json').read_text(encoding='utf-8'))
    results = data['results']
    models = sorted({m for r in results for m in r.get('actual_models', [])})
    selected = data['manifest']['selected']
    languages = data['manifest'].get('languages', ['capybara', 'python'])
    names = {'capybara': 'Capybara', 'python': 'Python puro', 'polars': 'Python con Polars'}
    comparison = ' frente a '.join(names[lang] for lang in languages)
    lines = ['# Benchmark de generación con Junie', '',
             f"- Inicio: {run['started_at']}",
             f"- Alias: `{run['model_alias']}`; modelo informado: {', '.join(models)}.",
             f"- Tareas seleccionadas: {len(selected)} de {data['manifest']['corpus_total']}; exclusiones registradas: {len(data['manifest']['excluded'])}.",
             '- Una respuesta por tarea y lenguaje; sesiones nuevas y sin feedback de tests.',
             f'- Comparación: {comparison}.',
             f"- Generaciones: {run['completed_generations']}/{run['planned_generations']}; corrida completa: {run['complete']}.",
             f"- Muestras emparejadas entre lenguajes: {data['paired_samples']}.",
             f"- Intentos de herramientas externas bloqueados: {sum(r.get('blocked_tool_attempts', 0) for r in results)}.",
             '', '| Lenguaje | Respuestas | Sintaxis válida | Pasan todos los tests | Exactitud |',
             '|---|---:|---:|---:|---:|']
    for language in languages:
        summary = data['summary'].get(language)
        if summary:
            lines.append(f"| {names[language]} | {summary['samples']} | {summary['syntax_success_samples']} | {summary['correct_samples']} | {summary['accuracy_on_submitted_samples']:.1%} |")
    lines += ['', '## Resultados por categoría', '', '| Categoría | '+' | '.join(names[lang] for lang in languages)+' |', '|---|---:|---:|']
    for category in sorted({r['category'] for r in results}):
        cells = []
        for language in languages:
            values = [r for r in results if r['category'] == category and r['language'] == language]
            cells.append(f"{sum(r['pass_all'] for r in values)}/{len(values)}")
        lines.append(f"| {category} | {' | '.join(cells)} |")
    lines += ['', '## Fallos', '']
    for language in languages:
        values = [r for r in results if r['language'] == language]
        statuses = Counter(r['status'] for r in values if not r['pass_all'])
        lines += [f"### {language}", '', ', '.join(f'{k}: {v}' for k, v in sorted(statuses.items())) or 'Sin fallos.', '']
        for row in values:
            if row['pass_all']:
                continue
            diagnostics = row.get('diagnostics', [])
            detail = '; '.join(f"{d['code']}: {d['message']}" for d in diagnostics)
            if not detail:
                detail = row.get('error', '')
            if not detail:
                detail = '; '.join(test.get('error', '') for test in row.get('tests', []) if test.get('error'))
            detail = detail.replace('\n', ' ')[:250]
            lines.append(f"- `{row['task_id']}`: {row['status']}. {detail}")
        lines.append('')
    capybara = [r for r in results if r['language']=='capybara']
    semicolons = sum(any(d['code']=='E_SYNTAX' and 'se esperaba: ";", "="' in d['message']
                         for d in r.get('diagnostics', [])) for r in capybara)
    missing_code = [f"{r['task_id']} ({r['language']})" for r in results
                    if r['status']=='compile_error' and '```' not in r['code']
                    and ('### Changes' in r['code'] or '### Verification' in r['code'])]
    lines += ['## Observaciones de esta corrida', '',
              f'- {semicolons} respuestas de Capybara fallaron por omitir el punto y coma requerido tras la fuente.',
              '- Algunas respuestas de Junie describen una solución sin entregar código: se conservaron y se contabilizaron como fallos, sin volver a solicitarlas.',
              f"- Respuestas descriptivas sin bloque de código detectadas: {', '.join(missing_code) or 'ninguna'}.",
              '- El caso original `str_003` usa las secuencias literales `\\t` y `\\n` en el JSON (barras escapadas), pero espera eliminarlas como si fueran caracteres de espacio en blanco. El resultado conserva la referencia original; conviene revisar esta inconsistencia del corpus antes de atribuir ese fallo al lenguaje.', '']
    lines += ['## Alcance', '',
              'Estos resultados corresponden a esta versión de los prompts y de Junie. '
              'Junie puede hacer varias llamadas internas por respuesta; no representan '
              'una llamada directa al modelo ni una comparación de velocidad de ejecución. '
              'Las respuestas no se corrigieron y los tests no se mostraron al generador. '
              'El criterio de corrección usa las salidas esperadas del corpus original de Anka. '
              'Una muestra por tarea no mide la variabilidad entre intentos.', '']
    destination = args.corrida / 'RESUMEN.md'
    destination.write_text('\n'.join(lines), encoding='utf-8')
    print(destination)


if __name__ == '__main__':
    main()
