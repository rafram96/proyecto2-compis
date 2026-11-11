"""Representación intermedia: un DAG de operadores por pipeline.

Cada nodo corresponde a una declaración del .etl (SOURCE, STEP, SINK…) con sus
entradas ya resueltas desde FLOW, y los nodos se guardan en orden topológico.
Las expresiones se reutilizan del AST. Los pases de optimización (passes.py)
transforman la IR y el backend genera código a partir de ella.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from graphlib import TopologicalSorter
import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .facts import NodeFacts, RangeRewrite
    from .joins import JoinRewrite

from . import ast as a
from .token import Span


@dataclass(frozen=True, slots=True)
class Ref:
    node: str
    port: str | None = None  # salida OUTPUT de una instancia USE


@dataclass(frozen=True, slots=True)
class Node:
    name: str
    kind: str  # SOURCE, INPUT, USE, SINK, OUTPUT o la operación del STEP (FILTER, JOIN…)
    inputs: tuple[tuple[str | None, Ref], ...]  # (puerto de entrada, productor)
    payload: object  # operación del AST para un STEP; la declaración en los demás casos
    span: Span
    origin: tuple[str, ...]  # declaraciones del .etl que representa este nodo

    def input(self, port: str | None = None) -> Ref:
        return dict(self.inputs)[port]


@dataclass(frozen=True, slots=True)
class Pipeline:
    name: str
    nodes: tuple[Node, ...]

    def consumers(self) -> dict[str, list[Node]]:
        found = defaultdict(list)
        for node in self.nodes:
            for _, ref in node.inputs:
                found[ref.node].append(node)
        return found


@dataclass(frozen=True, slots=True)
class Module:
    pipelines: tuple[Pipeline, ...]
    defaults: tuple[str, ...]  # pipelines raíz: sin INPUT y no usados por USE
    range_facts: tuple[NodeFacts, ...] = ()
    range_rewrites: tuple[RangeRewrite, ...] = ()
    join_rewrites: tuple[JoinRewrite, ...] = ()


KINDS = {a.Filter: "FILTER", a.Select: "SELECT", a.Derive: "DERIVE", a.Aggregate: "AGGREGATE",
         a.Join: "JOIN", a.Sort: "SORT", a.Distinct: "DISTINCT", a.Rename: "RENAME",
         a.FillNull: "FILL_NULL", a.DropNulls: "DROP_NULLS"}


def lower(program: a.Program) -> Module:
    """AST validado -> IR. Supone que validate(program) no reportó errores."""
    pipelines = []
    for pipe in program.pipelines:
        declarations = {d.name: d for d in pipe.declarations}
        incoming = defaultdict(list)
        for chain in pipe.flow.connections:
            for src, dst in zip(chain.endpoints, chain.endpoints[1:]):
                incoming[dst.name].append((dst.port, Ref(src.name, src.port)))
        graph = {name: sorted({ref.node for _, ref in incoming[name]}) for name in declarations}
        nodes = []
        for name in TopologicalSorter(graph).static_order():
            decl = declarations[name]
            if isinstance(decl, a.Step):
                kind, payload = KINDS[type(decl.operation)], decl.operation
            else:
                kind, payload = type(decl).__name__.upper(), decl
            nodes.append(Node(name, kind, tuple(incoming[name]), payload, decl.span, (name,)))
        pipelines.append(Pipeline(pipe.name, tuple(nodes)))
    used = {d.pipeline for p in program.pipelines for d in p.declarations if isinstance(d, a.Use)}
    defaults = tuple(p.name for p in program.pipelines if p.name not in used and
                     not any(isinstance(d, a.Input) for d in p.declarations))
    return Module(tuple(pipelines), defaults)


# Impresión textual, con la misma notación de expresiones que el DSL.

def literal_text(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    return str(value) if isinstance(value, (int, Decimal)) else repr(value)


def expr_text(node: a.Expr, top: bool = True) -> str:
    if isinstance(node, a.Literal):
        return literal_text(node.value)
    if isinstance(node, a.Column):
        return f"{node.qualifier}.{node.name}" if node.qualifier else node.name
    if isinstance(node, a.Call):
        return f"{node.name}({', '.join(expr_text(arg) for arg in node.arguments)})"
    if isinstance(node, a.UnaryExpr):
        operand = expr_text(node.operand, False)
        if node.operator in {"IS NULL", "IS NOT NULL"}:
            text = f"{operand} {node.operator}"
        else:
            text = f"NOT {operand}" if node.operator == "NOT" else f"-{operand}"
        return text if top else f"({text})"
    text = f"{expr_text(node.left, False)} {node.operator} {expr_text(node.right, False)}"
    return text if top else f"({text})"


def _schema_text(schema) -> str:
    if schema is None or schema.fields is None:
        return "TABLE"
    return "TABLE[" + ", ".join(f"{f.name}: {f.type.value}{'?' if f.nullable else ''}"
                                for f in schema.fields) + "]"


def _connector_text(connector) -> str:
    return f"{connector.name}(" + ", ".join(f"{arg.name}: {literal_text(arg.value.value)}"
                                            for arg in connector.arguments) + ")"


def _body(node: Node) -> str:
    p = node.payload
    if node.kind == "SOURCE":
        return f"{_connector_text(p.connector)} : {_schema_text(p.schema)}"
    if node.kind in {"INPUT", "OUTPUT"}:
        return _schema_text(p.schema)
    if node.kind == "SINK":
        return _connector_text(p.connector)
    if node.kind == "USE":
        return p.pipeline
    if node.kind == "FILTER":
        return expr_text(p.predicate)
    if node.kind in {"SELECT", "DISTINCT", "DROP_NULLS"}:
        return ", ".join(p.columns)
    if node.kind in {"DERIVE", "FILL_NULL"}:
        return "; ".join(f"{i.name} = {expr_text(i.expression)}" for i in p.assignments)
    if node.kind == "AGGREGATE":
        items = [f"{i.function}({expr_text(i.expression) if i.expression else ''}) AS {i.alias}"
                 for i in p.aggregations]
        return "; ".join(([f"GROUP_BY {', '.join(p.group_by)}"] if p.group_by else []) + items)
    if node.kind in {"JOIN", "CHECK_JOIN"}:
        return f"{p.kind} ON " + " AND ".join(f"{expr_text(c.left)} == {expr_text(c.right)}"
                                             for c in p.conditions) + ("; VERIFY MANY_TO_ONE" if p.guarantee else "")
    if node.kind == "SORT":
        return ", ".join(f"{k.name} {k.direction}" for k in p.keys)
    if node.kind == "RENAME":
        return ", ".join(f"{i.name} AS {i.alias}" for i in p.items)
    return ""


def _ref_text(ref: Ref) -> str:
    return "%" + ref.node + (f".{ref.port}" if ref.port else "")


def format_module(module: Module) -> str:
    """Formato textual de la IR: una línea por nodo, en orden topológico."""
    out = []
    for pipe in module.pipelines:
        out.append(f"pipeline {pipe.name}" + (" (raíz)" if pipe.name in module.defaults else "") + " {")
        width = max((len(n.name) for n in pipe.nodes), default=0) + 1
        for node in pipe.nodes:
            args = ", ".join((f"{port}=" if port else "") + _ref_text(ref) for port, ref in node.inputs)
            line = f"  {('%' + node.name).ljust(width)} = {node.kind}" + (f"({args})" if args else "")
            body = _body(node)
            if body:
                line += " { " + body + " }"
            if node.origin != (node.name,):
                line += "  // " + " + ".join(node.origin)
            out.append(line)
        out.append("}")
    for rewrite in module.range_rewrites:
        out.append(f"// rangos: {rewrite.pipeline}.{rewrite.node}: {rewrite.action}; "
                   f"{rewrite.before} -> {rewrite.after or 'entrada directa'}")
        for fact in rewrite.proof:
            lower = ('[' if fact.lower.inclusive else '(') + str(fact.lower.value) if fact.lower else '(-inf'
            upper = str(fact.upper.value) + (']' if fact.upper.inclusive else ')') if fact.upper else '+inf)'
            sources = ', '.join(dict.fromkeys(f'{e.pipeline}.{e.node}' for e in fact.evidence))
            nulls = "solo NULL" if fact.null_only else "puede contener NULL" if fact.nullable else "sin NULL"
            out.append(f"//   garantía: {fact.name} en {lower}, {upper}; {nulls}; {sources}")
    for rewrite in module.join_rewrites:
        out.append(f"// joins: {rewrite.pipeline}.{rewrite.node}: remove_inner_join; "
                   f"{rewrite.guarantee}; verificación: {rewrite.verification}")
    return "\n".join(out) + "\n"
