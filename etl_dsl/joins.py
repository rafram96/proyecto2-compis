"""O3: eliminación conservadora con obligación local, sin inferir integridad de datos."""
from dataclasses import dataclass, replace

from .semantic import infer
from .token import Span


@dataclass(frozen=True, slots=True)
class JoinRewrite:
    pipeline: str
    node: str
    action: str
    origin: tuple[str, ...]
    span: Span
    consumers: tuple[str, ...]
    retained: str
    eliminated: str
    guarantee: str
    declaration_span: Span
    verification: str
    obligations: tuple[str, ...]
    static_proof: tuple[str, ...]


def joins(module):
    """Solo elimina el lado derecho, detrás de una frontera SELECT en cada rama.

    CHECK_JOIN ocupa el lugar del JOIN y conserva entradas, span y origen.
    Las garantías se verifican sobre estas entradas exactas, nunca se propagan
    a través de transformaciones ni se confunden con los intervalos de C3.
    """
    issues, schemas = infer(module)
    if issues:
        return module
    pipelines, rewrites = [], []
    for pipe in module.pipelines:
        consumers = pipe.consumers()
        nodes = []
        for node in pipe.nodes:
            if (node.kind == 'JOIN' and node.payload.guarantee is not None
                    and node.payload.kind == 'INNER' and len(node.payload.conditions) == 1):
                left_ref, right_ref = node.input('left'), node.input('right')
                left = schemas[pipe.name][left_ref.node][left_ref.port or '']
                right = schemas[pipe.name][right_ref.node][right_ref.port or '']
                names = {c['name'] for c in left['columns']}
                users = consumers[node.name]
                # Los contratos de OUTPUT no proyectan. USE/SINK y cualquier
                # operación distinta de SELECT son una barrera conservadora.
                if (left['complete'] and right['complete'] and users and
                        all(user.kind == 'SELECT' and set(user.payload.columns) <= names
                            for user in users)):
                    rewrites.append(JoinRewrite(
                        pipe.name, node.name, 'remove_inner_join', node.origin, node.span,
                        tuple(user.name for user in users),
                        left_ref.node + (f'.{left_ref.port}' if left_ref.port else ''),
                        right_ref.node + (f'.{right_ref.port}' if right_ref.port else ''),
                        'VERIFY MANY_TO_ONE', node.payload.guarantee.span,
                        f'{pipe.name}.{node.name}: CHECK_JOIN / PolarsRuntime.verify_many_to_one',
                        ('equal_physical_key_types', 'nonnull_keys', 'unique_right_key',
                         'total_left_reference', 'materialized_input_snapshots'),
                        ('complete_input_columns', 'all_consumers_select_only_left_columns')))
                    node = replace(node, kind='CHECK_JOIN')
            nodes.append(node)
        pipelines.append(replace(pipe, nodes=tuple(nodes)))
    return replace(module, pipelines=tuple(pipelines),
                   join_rewrites=module.join_rewrites + tuple(rewrites))
