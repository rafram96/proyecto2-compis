"""Plan de IO sobre IR existente, sin implementar reglas del lenguaje."""
from dataclasses import replace
from pathlib import PurePosixPath
from etl_dsl.backend import _connector


def safe_file(value):
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or '..' in path.parts or '\\' in value or ':' in value or any(ord(c) < 32 for c in value):
        raise ValueError('E_PATH: use nombres relativos sin .., rutas absolutas ni URLs.')
    return str(path)


def requirements(module, selected):
    pipes = {p.name: p for p in module.pipelines}
    if selected not in pipes:
        raise ValueError('Pipeline no encontrado.')
    reached = set()

    def visit(name):
        if name in reached:
            return
        reached.add(name)
        for n in pipes[name].nodes:
            if n.kind == 'USE':
                visit(n.payload.pipeline)
    visit(selected)
    return [(p.name, n) for p in module.pipelines if p.name in reached for n in p.nodes
            if n.kind == 'SOURCE' or (p.name == selected and n.kind == 'INPUT')], reached


def validate_bindings(module, request, catalog, input_limit):
    required, reached = requirements(module, request.pipeline)
    bindings = {(b.pipeline, b.declaration): b for b in request.bindings}
    expected = {(p, n.name) for p, n in required}
    if len(bindings) != len(request.bindings) or set(bindings) != expected:
        raise ValueError('E_BINDINGS: enlace exactamente cada SOURCE alcanzado y cada INPUT del pipeline elegido; los INPUT de USE se enlazan mediante FLOW.')
    resolved = {}
    total = 0
    for p, n in required:
        b = bindings[p, n.name]
        e = catalog.resolve(b.dataset_id, b.version)
        if n.kind == 'SOURCE':
            driver, options = _connector(n.payload.connector)
            safe_file(options['file'])
            # Igualdad de opciones efectivas: solo se redirige file, nunca el conector ni la tabla.
            defaults = {'header': True, 'delimiter': ',', 'nullstr': ''} if driver == 'CSV' else {}
            actual = {**defaults, **{k: v for k, v in options.items() if k != 'file'}}
            authorized = {**defaults, **dict(e.options)}
            if driver != e.driver or actual != authorized:
                raise ValueError(f'E_BINDING_CONNECTOR: {p}.{n.name} no es compatible con {e.id}.')
        total += catalog.path(e).stat().st_size
        resolved[p, n.name] = e
    if total > input_limit:
        raise ValueError('E_INPUT_LIMIT: entradas mayores que el límite admitido.')
    for p in module.pipelines:
        if p.name in reached:
            for n in p.nodes:
                if n.kind == 'SINK':
                    _, options = _connector(n.payload.connector, sink=True)
                    safe_file(options['file'])
    return resolved, reached


def redirect(module, files, sink_paths):
    def node(p, n):
        if n.kind not in {'SOURCE', 'SINK'}:
            return n
        path = files[p, n.name] if n.kind == 'SOURCE' else sink_paths[p, n.name]
        c = n.payload.connector
        arguments = tuple(replace(arg, value=replace(arg.value, value=str(path)))
                          if arg.name == 'file' else arg for arg in c.arguments)
        return replace(n, payload=replace(n.payload, connector=replace(c, arguments=arguments)))
    # Las funciones no alcanzadas no se ejecutan; se mantienen sin abrir sus conectores.
    return replace(module, pipelines=tuple(replace(p, nodes=tuple(
        node(p.name, n) if (p.name, n.name) in files or (p.name, n.name) in sink_paths else n
        for n in p.nodes)) for p in module.pipelines))
