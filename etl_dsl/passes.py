"""Pases de optimización sobre la IR. Cada pase recibe y devuelve un ir.Module.

O1 (dominio):
- rangos: elimina predicados implicados por intervalos y ausencia de NULL,
  conservando pruebas y hechos por nodo en la IR.

O4 (optimizaciones clásicas):
- constantes: pliega expresiones entre literales y simplifica AND/OR/NOT con
  TRUE/FALSE; un FILTER cuya condición queda en TRUE desaparece.
- filtros: fusiona FILTER consecutivos en uno solo con AND.
- muertos: elimina pasos cuyo resultado no llega a ningún SINK, OUTPUT ni USE.
"""
from dataclasses import replace
from decimal import Decimal
import operator

from . import ast as a
from .ir import Module, Node, Pipeline, Ref
from .facts import ranges


def _number(value) -> bool:
    return isinstance(value, (int, Decimal)) and not isinstance(value, bool)


ARITHMETIC = {"+": operator.add, "-": operator.sub, "*": operator.mul}
COMPARISON = {"==": operator.eq, "!=": operator.ne, "<": operator.lt,
              "<=": operator.le, ">": operator.gt, ">=": operator.ge}


def fold(node: a.Expr) -> a.Expr:
    """Plegado de constantes con lógica de tres valores (NULL se deja sin plegar)."""
    if isinstance(node, a.UnaryExpr):
        operand = fold(node.operand)
        if isinstance(operand, a.Literal):
            value = operand.value
            if node.operator == "NOT" and isinstance(value, bool):
                return a.Literal(not value, span=node.span)
            if node.operator == "-" and _number(value):
                return a.Literal(-value, span=node.span)
        return replace(node, operand=operand)
    if isinstance(node, a.BinaryExpr):
        left, right = fold(node.left), fold(node.right)
        lv = left.value if isinstance(left, a.Literal) else ...
        rv = right.value if isinstance(right, a.Literal) else ...
        if node.operator in {"AND", "OR"}:
            # FALSE AND x = FALSE y TRUE OR x = TRUE también cuando x es NULL.
            absorbing, neutral = (False, True) if node.operator == "AND" else (True, False)
            if lv is absorbing or rv is absorbing:
                return a.Literal(absorbing, span=node.span)
            if lv is neutral:
                return right
            if rv is neutral:
                return left
        # La división no se pliega: Polars la evalúa como división real.
        elif node.operator in ARITHMETIC and _number(lv) and _number(rv):
            return a.Literal(ARITHMETIC[node.operator](lv, rv), span=node.span)
        elif node.operator in COMPARISON and (
                (_number(lv) and _number(rv)) or (isinstance(lv, str) and isinstance(rv, str))):
            return a.Literal(COMPARISON[node.operator](lv, rv), span=node.span)
        return replace(node, left=left, right=right)
    if isinstance(node, a.Call):
        return replace(node, arguments=tuple(fold(arg) for arg in node.arguments))
    return node


def _fold_operation(op):
    if isinstance(op, a.Filter):
        return replace(op, predicate=fold(op.predicate))
    if isinstance(op, (a.Derive, a.FillNull)):
        return replace(op, assignments=tuple(replace(i, expression=fold(i.expression))
                                             for i in op.assignments))
    if isinstance(op, a.Aggregate):
        return replace(op, aggregations=tuple(
            i if i.expression is None else replace(i, expression=fold(i.expression))
            for i in op.aggregations))
    return op


def _bypass(pipe: Pipeline, removed: dict[str, Ref]) -> Pipeline:
    """Quita nodos y conecta sus consumidores directamente con la entrada del nodo quitado."""
    def resolve(ref):
        while ref.port is None and ref.node in removed:
            ref = removed[ref.node]
        return ref
    nodes = tuple(replace(n, inputs=tuple((port, resolve(ref)) for port, ref in n.inputs))
                  for n in pipe.nodes if n.name not in removed)
    return replace(pipe, nodes=nodes)


def constants(module: Module) -> Module:
    pipelines = []
    for pipe in module.pipelines:
        nodes = tuple(replace(n, payload=_fold_operation(n.payload)) if n.kind in
                      {"FILTER", "DERIVE", "FILL_NULL", "AGGREGATE"} else n for n in pipe.nodes)
        pipe = replace(pipe, nodes=nodes)
        removed = {n.name: n.input() for n in pipe.nodes if n.kind == "FILTER"
                   and isinstance(n.payload.predicate, a.Literal) and n.payload.predicate.value is True}
        pipelines.append(_bypass(pipe, removed))
    return replace(module, pipelines=tuple(pipelines))


def filters(module: Module) -> Module:
    pipelines = []
    for pipe in module.pipelines:
        nodes = {n.name: n for n in pipe.nodes}
        consumers = pipe.consumers()
        removed = set()
        for node in pipe.nodes:  # orden topológico: cada productor ya está fusionado
            if node.kind != "FILTER":
                continue
            upstream = nodes[node.input().node]
            if upstream.kind == "FILTER" and len(consumers[upstream.name]) == 1:
                predicate = a.BinaryExpr("AND", upstream.payload.predicate, node.payload.predicate,
                                         span=node.payload.span)
                nodes[node.name] = replace(node, inputs=upstream.inputs,
                                           payload=replace(node.payload, predicate=predicate),
                                           span=upstream.span, origin=upstream.origin + node.origin)
                removed.add(upstream.name)
        pipelines.append(replace(pipe, nodes=tuple(nodes[n.name] for n in pipe.nodes
                                                   if n.name not in removed)))
    return replace(module, pipelines=tuple(pipelines))


def dead(module: Module) -> Module:
    pipelines = []
    for pipe in module.pipelines:
        nodes = {n.name: n for n in pipe.nodes}
        # SINK y OUTPUT son el resultado; USE puede escribir SINK propios; INPUT es la interfaz.
        live = {n.name for n in pipe.nodes if n.kind in {"SINK", "OUTPUT", "USE", "INPUT"}}
        pending = list(live)
        while pending:
            for _, ref in nodes[pending.pop()].inputs:
                if ref.node not in live:
                    live.add(ref.node)
                    pending.append(ref.node)
        pipelines.append(replace(pipe, nodes=tuple(n for n in pipe.nodes if n.name in live)))
    return replace(module, pipelines=tuple(pipelines))


PASSES = {"constantes": constants, "rangos": ranges, "filtros": filters, "muertos": dead}
DEFAULT = tuple(PASSES)


def optimize(module: Module, passes=DEFAULT) -> Module:
    unknown = [name for name in passes if name not in PASSES]
    if unknown:
        raise ValueError(f"Pases desconocidos: {unknown}; disponibles: {list(PASSES)}.")
    for name in passes:
        module = PASSES[name](module)
    return module
