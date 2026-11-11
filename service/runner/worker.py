"""Un proceso por trabajo. Solo ejecuta Python generado de nuevo por etl_dsl."""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import sys
import threading
import time
from uuid import uuid4


def parent_guard(parent):
    while True:
        if os.getppid() != parent:
            os.kill(os.getpid(), signal.SIGKILL)
        time.sleep(.2)


def execute(work, payload):
    from etl_dsl import analyze, parse
    from etl_dsl.backend import build_ir, generate
    from etl_dsl.runtime import PolarsRuntime, run_pipelines
    from service.catalog import Catalog, digest
    from service.runner.bindings import redirect, safe_file, validate_bindings
    from service.schemas import RunRequest

    request = RunRequest.model_validate(payload['request'])
    limits = payload['limits']
    catalog = Catalog(payload['datasets'])
    analysis = analyze(request.source, filename=request.filename, passes=request.passes, artifacts=('python',))
    if not analysis.ok:
        return {'state': 'failed', 'diagnostics': analysis.to_dict()['diagnostics']}
    original, optimized = build_ir(parse(request.source), passes=analysis.passes)
    resolved, reached = validate_bindings(original, request, catalog, limits['input_bytes'])
    files = {}
    for i, (key, entry) in enumerate(resolved.items()):
        source = catalog.path(entry)
        target = work / 'inputs' / f'{i}{source.suffix}'
        shutil.copyfile(source, target)
        if digest(target) != payload['hashes'][entry.id]:
            raise ValueError('E_DATASET_CHANGED: el dataset cambió desde la aceptación.')
        files[key] = target
    sink_paths, logical = {}, {}
    descriptions = {}
    for p in original.pipelines:
        if p.name not in reached:
            continue
        for n in p.nodes:
            if n.kind == 'SINK':
                options = {arg.name: arg.value.value for arg in n.payload.connector.arguments}
                name = safe_file(options['file'])
                if name not in logical:
                    logical[name] = work / 'files' / f'{len(logical)}{Path(name).suffix}'
                sink_paths[p.name, n.name] = logical[name]
                label = f'{request.filename}:{n.span.line}:{n.span.column} {p.name}.{"+".join(n.origin)}'
                descriptions[label] = (p.name, n.name, Path(name).name)
    optimized = redirect(optimized, files, sink_paths)
    namespace = {'__name__': 'cauce_generated'}
    exec(compile(generate(optimized, filename=request.filename, base_dir=work), '<generated>', 'exec'), namespace)
    outputs, artifacts, private, artifact_files = {}, {}, {}, {}

    def materialize(frame, pipeline, declaration, kind, file=None, name=None, schema=None, driver="PARQUET"):
        if frame.height > limits['max_rows'] or frame.width > limits['max_columns'] or frame.estimated_size() > limits['memory_bytes'] // 2:
            raise ValueError('E_OUTPUT_LIMIT: salida demasiado grande.')
        # Captura por declaración; una USE repetida conserva la última invocación de ese SINK.
        output_id = f'o{len(outputs)}' if (pipeline, declaration) not in outputs else outputs[pipeline, declaration]['id']
        if file is None:
            file = work / 'files' / f'{uuid4().hex}.parquet'
            frame.write_parquet(file)
            name = f'{pipeline}-{declaration}.parquet'
        artifact_id = artifact_files.setdefault(file, 'a' + uuid4().hex)
        snapshot = work / 'previews' / f'{output_id}.arrow'
        frame.write_ipc(snapshot)
        declared = {f.name: f.nullable for f in schema.fields} if schema and schema.fields else {}
        nulls = frame.null_count().row(0)
        columns = [dict(name=n, dtype=str(t), nullable=bool(count), declared_nullable=declared.get(n))
                   for (n, t), count in zip(frame.schema.items(), nulls)]
        outputs[pipeline, declaration] = dict(id=output_id, pipeline=pipeline, declaration=declaration,
                kind=kind, rows=frame.height, columns=columns, artifact_id=artifact_id)
        artifacts[artifact_id] = dict(id=artifact_id, name=name,
                media_type={'CSV': 'text/csv', 'PARQUET': 'application/vnd.apache.parquet'}.get(driver, 'application/octet-stream'),
                bytes=file.stat().st_size)
        private[output_id] = str(snapshot.relative_to(work))
        private[artifact_id] = str(file.relative_to(work))
        if any(p.stat().st_size > limits['file_bytes'] for p in work.rglob('*') if p.is_file()) or sum(p.stat().st_size for p in work.rglob('*') if p.is_file()) > limits['work_bytes']:
            raise ValueError('E_STORAGE_LIMIT: archivos del trabajo mayores que el límite.')

    class BoundRuntime(PolarsRuntime):
        def _path(self, value):
            path = super()._path(value)
            if not path.is_relative_to(work) or path.is_symlink():
                raise ValueError('E_PATH: ruta fuera del trabajo.')
            return path

        def sink(self, table, driver, options, label):
            # Contratos y escritura conservan la implementación original.
            result = super().sink(table, driver, options, label)
            pipeline, declaration, name = descriptions[label]
            materialize(self.collect(result, label), pipeline, declaration, 'SINK', self._path(options['file']), name, driver=driver)
            return result

    with BoundRuntime(work) as rt:
        inputs = {}
        for (pipeline, name), entry in resolved.items():
            node = next(n for p in original.pipelines if p.name == pipeline for n in p.nodes if n.name == name)
            if node.kind == 'INPUT':
                inputs[name] = rt.source(entry.driver, {**dict(entry.options), 'file': str(files[pipeline, name])}, None, f'{pipeline}.{name}')
        results = run_pipelines(rt, namespace['PIPELINES'], namespace['DEFAULT_PIPELINES'], [request.pipeline], {request.pipeline: inputs})
        root = next(p for p in original.pipelines if p.name == request.pipeline)
        for name, table in results[request.pipeline].items():
            node = next(n for n in root.nodes if n.name == name)
            if node.kind == 'OUTPUT':
                materialize(rt.collect(table, name), request.pipeline, name, 'OUTPUT', schema=node.payload.schema)
    used_artifacts = {o['artifact_id'] for o in outputs.values()}
    # Los tamaños se toman al final: varios SINK pueden compartir un archivo DuckDB/CSV.
    for aid in used_artifacts:
        artifacts[aid]['bytes'] = (work / private[aid]).stat().st_size
    return {'state': 'succeeded', 'outputs': list(outputs.values()),
            'artifacts': [a for key, a in artifacts.items() if key in used_artifacts], 'private': private}


def main():
    work = Path(sys.argv[1]).resolve()
    payload = json.loads((work / 'request.json').read_text())
    parent = int(sys.argv[2])
    threading.Thread(target=parent_guard, args=(parent,), daemon=True).start()
    import resource
    resource.setrlimit(resource.RLIMIT_FSIZE, (payload['limits']['file_bytes'],) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (max(1, int(payload['timeout']) + 1),) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    try:
        result = execute(work, payload)
    except Exception as exc:
        # Polars puede incluir filas/valores/rutas en excepciones. Exponer solo códigos conocidos.
        code = re.search(r'\bE_[A-Z_]+\b', str(exc))
        code = code.group() if code else 'E_EXECUTION'
        messages = {
            'E_JOIN_UNIQUE': 'La clave derecha contiene duplicados.',
            'E_JOIN_REFERENCE': 'Hay claves izquierdas sin coincidencia derecha.',
            'E_JOIN_NULL': 'Las claves del JOIN contienen NULL.',
            'E_JOIN_KEY_TYPE': 'Las claves requieren el mismo dtype físico.',
            'E_NULL': 'Un contrato no nullable contiene NULL.',
            'E_SCHEMA': 'Las columnas u orden no satisfacen el contrato.',
            'E_TYPE': 'Un tipo físico no satisface el contrato.',
            'E_COLUMN': 'No existe una columna requerida.',
            'E_SOURCE': 'No se pudo abrir una entrada autorizada.',
            'E_DATASET_UNAVAILABLE': 'Una entrada autorizada está ausente o modificada; prepare los datasets de nuevo.',
            'E_DATASET_CHANGED': 'El dataset cambió desde la aceptación; prepare datos y vuelva a ejecutar.',
            'E_PATH': 'Ruta no autorizada.',
            'E_OUTPUT_LIMIT': 'La salida supera los límites de filas, columnas o memoria.',
            'E_STORAGE_LIMIT': 'Los archivos superan el límite de almacenamiento.',
        }
        result = {'state': 'failed', 'diagnostics': [dict(phase='runtime', code=code, severity='error',
            message=messages.get(code, 'La ejecución falló. Compruebe los contratos y los límites de la demo.'),
            filename=payload['request']['filename'], span=None)]}
    destination = work / 'result.tmp'
    destination.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    destination.replace(work / 'result.json')


if __name__ == '__main__':
    main()
