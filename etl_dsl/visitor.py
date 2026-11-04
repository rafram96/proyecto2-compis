"""Construcción y recorridos del AST mediante visitantes."""
from dataclasses import fields
from decimal import Decimal
import json

from lark import Transformer, v_args

from . import ast as a


def iter_child_nodes(node: a.Node):
    """Hijos directos, en orden de declaración de los campos del nodo."""
    for field in fields(node):
        value = getattr(node, field.name)
        if isinstance(value, a.Node):
            yield value
        elif isinstance(value, tuple):
            yield from (item for item in value if isinstance(item, a.Node))


def walk(node: a.Node):
    """Recorrido en preorden sin depender de Lark."""
    yield node
    for child in iter_child_nodes(node):
        yield from walk(child)


class NodeVisitor:
    """Sobrescribir visit_NombreDeClase; generic_visit recorre los hijos."""

    def visit(self, node: a.Node):
        method = getattr(self, f"visit_{type(node).__name__}", self.generic_visit)
        return method(node)

    def generic_visit(self, node: a.Node):
        for child in iter_child_nodes(node):
            self.visit(child)


def _span(meta) -> a.Span:
    return a.Span(meta.line, meta.column, meta.end_line, meta.end_column,
                  meta.start_pos, meta.end_pos)


@v_args(meta=True)
class ASTBuilder(Transformer):
    def start(self, meta, children):
        return a.Program(tuple(children), span=_span(meta))

    def pipeline(self, meta, children):
        return a.Pipeline(str(children[0]), tuple(children[1:-1]), children[-1], span=_span(meta))

    def scalar_type(self, meta, children):
        return a.ScalarType(str(children[0]))

    def nullable(self, meta, children):
        return True

    def field(self, meta, children):
        return a.Field(str(children[0]), children[1], len(children) == 3, span=_span(meta))

    def table_schema(self, meta, children):
        return a.TableSchema(tuple(children), span=_span(meta))

    def unknown_table_schema(self, meta, children):
        return a.TableSchema(None, span=_span(meta))

    def table_type(self, meta, children):
        return children[0]

    def input_decl(self, meta, children):
        return a.Input(str(children[0]), children[1], span=_span(meta))

    def output_decl(self, meta, children):
        return a.Output(str(children[0]), children[1], span=_span(meta))

    def source_decl(self, meta, children):
        return a.Source(str(children[0]), children[1] if len(children) == 3 else None,
                        children[-1], span=_span(meta))

    def sink_decl(self, meta, children):
        return a.Sink(str(children[0]), children[1], span=_span(meta))

    def use_decl(self, meta, children):
        return a.Use(str(children[0]), str(children[1]), span=_span(meta))

    def step_decl(self, meta, children):
        return a.Step(str(children[0]), children[1], span=_span(meta))

    def connector(self, meta, children):
        return a.Connector(str(children[0]), children[1] if len(children) > 1 else (), span=_span(meta))

    def arguments(self, meta, children):
        return tuple(children)

    def argument(self, meta, children):
        return a.Argument(str(children[0]), children[1], span=_span(meta))

    def number(self, meta, children):
        raw = str(children[0])
        value = Decimal(raw) if any(c in raw.lower() for c in ".e") else int(raw)
        return a.Literal(value, span=_span(meta))

    def negative_literal(self, meta, children):
        literal = self.number(meta, children)
        value = literal.value
        # El operador - de Decimal aplica el contexto y puede redondear el literal.
        value = value.copy_negate() if isinstance(value, Decimal) else -value
        return a.Literal(value, span=literal.span)

    def string(self, meta, children):
        return a.Literal(json.loads(str(children[0])), span=_span(meta))

    def true(self, meta, children):
        return a.Literal(True, span=_span(meta))

    def false(self, meta, children):
        return a.Literal(False, span=_span(meta))

    def null(self, meta, children):
        return a.Literal(None, span=_span(meta))

    def qualified_column(self, meta, children):
        return a.Column(str(children[-1]), str(children[0]) if len(children) == 2 else None,
                        span=_span(meta))

    def scalar_function(self, meta, children):
        return a.Call(str(children[0]), tuple(children[1:]), span=_span(meta))

    def _fold(self, meta, children, operator=None):
        result = children[0]
        pairs = ((operator, child) for child in children[1:]) if operator else zip(children[1::2], children[2::2])
        for op, right in pairs:
            span = a.Span(result.span.line, result.span.column, right.span.end_line,
                          right.span.end_column, result.span.start, right.span.end)
            result = a.BinaryExpr(str(op), result, right, span=span)
        return result

    def or_expr(self, meta, children):
        return self._fold(meta, children, "OR")

    def and_expr(self, meta, children):
        return self._fold(meta, children, "AND")

    def sum(self, meta, children):
        return self._fold(meta, children)

    def product(self, meta, children):
        return self._fold(meta, children)

    def compare(self, meta, children):
        return a.BinaryExpr(str(children[1]), children[0], children[2], span=_span(meta))

    def neg(self, meta, children):
        return a.UnaryExpr("-", children[0], span=_span(meta))

    def not_op(self, meta, children):
        return a.UnaryExpr("NOT", children[0], span=_span(meta))

    def is_null(self, meta, children):
        return a.UnaryExpr("IS NULL", children[0], span=_span(meta))

    def is_not_null(self, meta, children):
        return a.UnaryExpr("IS NOT NULL", children[0], span=_span(meta))

    def names(self, meta, children):
        return tuple(map(str, children))

    def filter_op(self, meta, children):
        return a.Filter(children[0], span=_span(meta))

    def select_op(self, meta, children):
        return a.Select(children[0], span=_span(meta))

    def assignment(self, meta, children):
        return a.Assignment(str(children[0]), children[1], span=_span(meta))

    def derive_op(self, meta, children):
        return a.Derive(tuple(children), span=_span(meta))

    def fill_null_op(self, meta, children):
        return a.FillNull(tuple(children), span=_span(meta))

    def group_by(self, meta, children):
        return children[0]

    def aggregation(self, meta, children):
        return a.Aggregation(str(children[0]), children[1] if len(children) == 3 else None,
                             str(children[-1]), span=_span(meta))

    def aggregate_op(self, meta, children):
        grouped = isinstance(children[0], tuple)
        return a.Aggregate(children[0] if grouped else (), tuple(children[1:] if grouped else children),
                           span=_span(meta))

    def join_type(self, meta, children):
        return str(children[0])

    def join_condition(self, meta, children):
        return a.JoinCondition(children[0], children[2], span=_span(meta))

    def join_op(self, meta, children):
        return a.Join(children[0], tuple(children[1:]), span=_span(meta))

    def sort_dir(self, meta, children):
        return str(children[0])

    def sort_key(self, meta, children):
        return a.SortKey(str(children[0]), children[1] if len(children) > 1 else "ASC", span=_span(meta))

    def sort_op(self, meta, children):
        return a.Sort(tuple(children), span=_span(meta))

    def distinct_op(self, meta, children):
        return a.Distinct(children[0], span=_span(meta))

    def drop_nulls_op(self, meta, children):
        return a.DropNulls(children[0], span=_span(meta))

    def rename_item(self, meta, children):
        return a.RenameItem(str(children[0]), str(children[1]), span=_span(meta))

    def rename_op(self, meta, children):
        return a.Rename(tuple(children), span=_span(meta))

    def endpoint(self, meta, children):
        return a.Endpoint(str(children[0]), str(children[1]) if len(children) == 2 else None, span=_span(meta))

    def connection(self, meta, children):
        return a.Connection(tuple(children), span=_span(meta))

    def flow(self, meta, children):
        return a.Flow(tuple(children), span=_span(meta))
