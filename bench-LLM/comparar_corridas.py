"""Compara dos corridas del mismo corpus sin modificar sus respuestas."""
import argparse
import json
from pathlib import Path


def semicolons(data):
    return sum(any(d['code']=='E_SYNTAX' and 'se esperaba: ";", "="' in d['message']
                   for d in row.get('diagnostics', []))
               for row in data['results'] if row['language']=='capybara')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('anterior', type=Path)
    parser.add_argument('actual', type=Path)
    args = parser.parse_args()
    old = json.loads((args.anterior/'evaluacion.json').read_text(encoding='utf-8'))
    new = json.loads((args.actual/'evaluacion.json').read_text(encoding='utf-8'))
    if old['manifest']['selected'] != new['manifest']['selected']:
        parser.error('Las tareas seleccionadas no coinciden.')
    languages = new['manifest'].get('languages', ['capybara','python'])
    if old['manifest'].get('languages', ['capybara','python']) != languages:
        parser.error('Los lenguajes comparados son diferentes.')
    old_models = sorted({m for r in old['results'] for m in r.get('actual_models',[])})
    new_models = sorted({m for r in new['results'] for m in r.get('actual_models',[])})
    names = {'capybara':'Capybara','polars':'Python con Polars','python':'Python puro'}
    lines = ['# Comparación de corridas', '',
             f'- Anterior: `{args.anterior.name}`.', f'- Actual: `{args.actual.name}`.',
             f'- Modelos informados: anterior {old_models}; actual {new_models}.',
             '- Mismas tareas y referencias; respuestas nuevas por cada lenguaje.', '',
             '| Medida | Anterior | Actual |', '|---|---:|---:|']
    for language in languages:
        before, after = old['summary'][language], new['summary'][language]
        lines.append(f"| {names[language]}: respuestas correctas | {before['correct_samples']}/{before['samples']} ({before['accuracy_on_submitted_samples']:.1%}) | {after['correct_samples']}/{after['samples']} ({after['accuracy_on_submitted_samples']:.1%}) |")
        lines.append(f"| {names[language]}: sintaxis válida | {before['syntax_success_samples']}/{before['samples']} | {after['syntax_success_samples']}/{after['samples']} |")
    lines.append(f'| Capybara: errores por omitir `;` tras la fuente | {semicolons(old)} | {semicolons(new)} |')
    lines += ['', '## Condiciones', '']
    before_templates, after_templates = old['manifest']['templates_sha256'], new['manifest']['templates_sha256']
    for language in languages:
        changed = before_templates[language] != after_templates[language]
        lines.append(f"- Plantilla de {names[language]}: {'modificada' if changed else 'idéntica'}.")
    lines += ['- Los programas generados no se corrigieron ni se reintentaron por fallar los tests.',
              '- El énfasis en el punto y coma se añadió después de observar la corrida anterior.',
              '- Esta comparación usa una muestra por tarea y lenguaje. Las diferencias observadas no aíslan la variabilidad del modelo ni constituyen una validación independiente.', '']
    destination = args.actual/'COMPARACION.md'
    destination.write_text('\n'.join(lines), encoding='utf-8')
    print(destination)


if __name__=='__main__':
    main()
