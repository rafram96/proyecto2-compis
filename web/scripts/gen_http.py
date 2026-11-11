"""Genera tipos TS desde el OpenAPI real. --check detecta deriva de contrato."""
import argparse
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from service.app import create_app

ROOT = Path(__file__).resolve().parents[2]


def ts(schema):
    if '$ref' in schema:
        return schema['$ref'].split('/')[-1]
    if 'const' in schema:
        return json.dumps(schema['const'])
    if 'enum' in schema:
        return ' | '.join(json.dumps(e) for e in schema['enum'])
    if 'anyOf' in schema:
        return '(' + ' | '.join(ts(s) for s in schema['anyOf']) + ')'
    kind = schema.get('type')
    if kind == 'array':
        return f'Array<{ts(schema["items"])}>'
    if kind == 'object':
        if 'properties' not in schema:
            return f'Record<string, {ts(schema["additionalProperties"]) if isinstance(schema.get("additionalProperties"), dict) else "unknown"}>'
        required = schema.get('required', [])
        return '{\n' + '\n'.join(f'  {json.dumps(k)}{"" if k in required else "?"}: {ts(v)};' for k, v in schema['properties'].items()) + '\n}'
    return {'string': 'string', 'integer': 'number', 'number': 'number', 'boolean': 'boolean', 'null': 'null'}.get(kind, 'unknown')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    spec = create_app().openapi()
    content = '// Generado por web/scripts/gen_http.py desde FastAPI; no editar.\n'
    content += '\n\n'.join(f'export type {name} = {ts(schema)};' for name, schema in spec['components']['schemas'].items()) + '\n'
    files = {ROOT / 'web/src/execution/types.ts': content,
             ROOT / 'docs/http_openapi.json': json.dumps(spec, ensure_ascii=False, indent=2) + '\n'}
    for path, text in files.items():
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise SystemExit(f'{path.relative_to(ROOT)} desactualizado; ejecute gen_http.py')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')


if __name__ == '__main__':
    main()
