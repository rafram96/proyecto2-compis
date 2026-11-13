"""AST inmutable del frontend. No contiene objetos de Polars ni conexiones."""
from __future__ import annotations

from dataclasses import dataclass, fields, is_dataclass
from decimal import Decimal
from enum import Enum

from .token import Span
from .type import ScalarType
from typing import Any


@dataclass(frozen=True, slots=True, kw_only=True)
class Node:
    span: Span


@dataclass(frozen=True, slots=True)
class Field(Node):
    name: str
    type: ScalarType
    nullable: bool = False


@dataclass(frozen=True, slots=True)
class TableSchema(Node):
    # None representa TABLE sin esquema conocido; () no se acepta en la sintaxis.
    fields: tuple[Field, ...] | None


@dataclass(frozen=True, slots=True)
class Literal(Node):
    value: int | Decimal | str | bool | None


@dataclass(frozen=True, slots=True)
class Column(Node):
    name: str
    qualifier: str | None = None


@dataclass(frozen=True, slots=True)
class UnaryExpr(Node):
    operator: str
    operand: Expr


@dataclass(frozen=True, slots=True)
class BinaryExpr(Node):
    operator: str
    left: Expr
    right: Expr


@dataclass(frozen=True, slots=True)
class Call(Node):
    name: str
    arguments: tuple[Expr, ...]


Expr = Literal | Column | UnaryExpr | BinaryExpr | Call


@dataclass(frozen=True, slots=True)
class Argument(Node):
    name: str
    value: Literal


@dataclass(frozen=True, slots=True)
class Connector(Node):
    name: str
    arguments: tuple[Argument, ...]


@dataclass(frozen=True, slots=True)
class Assignment(Node):
    name: str
    expression: Expr


@dataclass(frozen=True, slots=True)
class Aggregation(Node):
    function: str
    expression: Expr | None
    alias: str


@dataclass(frozen=True, slots=True)
class JoinCondition(Node):
    left: Column
    right: Column


@dataclass(frozen=True, slots=True)
class SortKey(Node):
    name: str
    direction: str = "ASC"


@dataclass(frozen=True, slots=True)
class RenameItem(Node):
    name: str
    alias: str


@dataclass(frozen=True, slots=True)
class Filter(Node):
    predicate: Expr


@dataclass(frozen=True, slots=True)
class Select(Node):
    columns: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Derive(Node):
    assignments: tuple[Assignment, ...]


@dataclass(frozen=True, slots=True)
class Aggregate(Node):
    group_by: tuple[str, ...]
    aggregations: tuple[Aggregation, ...]


@dataclass(frozen=True, slots=True)
class Join(Node):
    kind: str
    conditions: tuple[JoinCondition, ...]


@dataclass(frozen=True, slots=True)
class Sort(Node):
    keys: tuple[SortKey, ...]


@dataclass(frozen=True, slots=True)
class Distinct(Node):
    columns: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Rename(Node):
    items: tuple[RenameItem, ...]


@dataclass(frozen=True, slots=True)
class FillNull(Node):
    assignments: tuple[Assignment, ...]


@dataclass(frozen=True, slots=True)
class DropNulls(Node):
    columns: tuple[str, ...]


Operation = Filter | Select | Derive | Aggregate | Join | Sort | Distinct | Rename | FillNull | DropNulls


@dataclass(frozen=True, slots=True)
class Input(Node):
    name: str
    schema: TableSchema


@dataclass(frozen=True, slots=True)
class Output(Node):
    name: str
    schema: TableSchema


@dataclass(frozen=True, slots=True)
class Source(Node):
    name: str
    schema: TableSchema | None
    connector: Connector


@dataclass(frozen=True, slots=True)
class Sink(Node):
    name: str
    connector: Connector


@dataclass(frozen=True, slots=True)
class Step(Node):
    name: str
    operation: Operation


@dataclass(frozen=True, slots=True)
class Use(Node):
    pipeline: str
    name: str


Declaration = Input | Output | Source | Sink | Step | Use


@dataclass(frozen=True, slots=True)
class Endpoint(Node):
    name: str
    port: str | None = None


@dataclass(frozen=True, slots=True)
class Connection(Node):
    endpoints: tuple[Endpoint, ...]


@dataclass(frozen=True, slots=True)
class Flow(Node):
    connections: tuple[Connection, ...]


@dataclass(frozen=True, slots=True)
class Pipeline(Node):
    name: str
    declarations: tuple[Declaration, ...]
    flow: Flow
    # True si se escribió en forma lineal (FROM ... TO); el FLOW se dedujo del orden.
    linear: bool = False


@dataclass(frozen=True, slots=True)
class Program(Node):
    pipelines: tuple[Pipeline, ...]


def to_dict(value: Any) -> Any:
    """Representación JSON; los decimales se serializan como texto sin perder precisión."""
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {"node": type(value).__name__, **{
            field.name: to_dict(getattr(value, field.name)) for field in fields(value)
        }}
    if isinstance(value, tuple):
        return [to_dict(item) for item in value]
    if isinstance(value, Decimal):
        return str(value)
    return value
