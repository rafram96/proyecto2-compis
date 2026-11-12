"""Inferencia de esquemas y verificación estática de tipos sobre la IR.

Calcula el esquema de salida de cada nodo (columnas en orden, tipo y
nulabilidad) y reporta, sin leer datos, los errores que la ejecución
produciría con seguridad: columnas inexistentes, tipos incompatibles en
expresiones, nombres de salida ambiguos y contratos que no se cumplen.

Un SOURCE sin anotación tiene esquema desconocido (None). Los nodos que
dependen de él solo se verifican en lo que se puede saber; el resto queda a
cargo de las verificaciones del runtime. La nulabilidad declarada en los
contratos también se verifica en ejecución: el análisis no la exige aquí.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from graphlib import TopologicalSorter

from . import ast as a
from .diagnostics import Diagnostic
from .ir import Col, Module, Node, Pipeline, Ref, Schema, expr_text
from .type import ScalarType

T = ScalarType
NUMERIC = frozenset({T.INT, T.DECIMAL})
BOOLEAN = frozenset({T.BOOL})
TEXT = frozenset({T.STRING})


@dataclass(frozen=True, slots=True)
class Typed:
    type: ScalarType | None
    nullable: bool


UNKNOWN = Typed(None, True)


@dataclass(frozen=True, slots=True)
class TypeInfo:
    schemas: dict[tuple[str, str], Schema]  # (pipeline, nodo) -> esquema de salida
    diagnostics: tuple[Diagnostic, ...]


def _declared(schema: a.TableSchema | None) -> Schema:
    if schema is None or schema.fields is None:
        return None
    return tuple(Col(f.name, f.type, f.nullable) for f in schema.fields)


def _numeric_result(*types: ScalarType | None) -> ScalarType | None:
    if any(t is None for t in types):
        return None
    return T.INT if all(t is T.INT for t in types) else T.DECIMAL


def _compatible(left: ScalarType | None, right: ScalarType | None) -> bool:
    return left is None or right is None or left is right or {left, right} <= NUMERIC


def _accepts(expected: ScalarType, actual: ScalarType | None) -> bool:
    """Igual que el contrato del runtime: DECIMAL es la familia numérica."""
    return actual is None or actual is expected or (expected is T.DECIMAL and actual is T.INT)


def _name(t: ScalarType | None) -> str:
    return t.value if t else "ANY"


class Checker:
    def __init__(self, module: Module):
        self.module = module
        self.pipelines = {p.name: p for p in module.pipelines}
        self.schemas: dict[tuple[str, str], Schema] = {}
        self.ports: dict[tuple[str, str, str], Schema] = {}  # (pipeline, USE, OUTPUT) -> esquema
        self.diagnostics: list[Diagnostic] = []

    def error(self, code: str, message: str, node: a.Node | Node) -> None:
        self.diagnostics.append(Diagnostic(code, message, node.span))

    def run(self) -> TypeInfo:
        # Cada pipeline usado por USE se analiza antes que quien lo usa.
        graph = {p.name: {n.payload.pipeline for n in p.nodes if n.kind == "USE"} for p in self.module.pipelines}
        for name in TopologicalSorter(graph).static_order():
            self.pipeline(self.pipelines[name])
        return TypeInfo(dict(self.schemas), tuple(sorted(self.diagnostics, key=lambda d: d.span.start)))

    # Esquemas

    def pipeline(self, pipe: Pipeline) -> None:
        def schema_of(ref: Ref) -> Schema:
            if ref.port is None:
                return self.schemas[pipe.name, ref.node]
            return self.ports[pipe.name, ref.node, ref.port]

        for node in pipe.nodes:
            inputs = {port: schema_of(ref) for port, ref in node.inputs}
            self.schemas[pipe.name, node.name] = self.node(pipe, node, inputs)

    def node(self, pipe: Pipeline, node: Node, inputs: dict[str | None, Schema]) -> Schema:
        p = node.payload
        if node.kind in {"SOURCE", "INPUT"}:
            return _declared(p.schema)
        if node.kind == "SINK":
            return inputs[None]
        if node.kind == "OUTPUT":
            declared = _declared(p.schema)
            if declared is None:
                return inputs[None]
            self.conform(declared, inputs[None], node, f"OUTPUT {node.name}")
            return declared
        if node.kind == "USE":
            child = self.pipelines[p.pipeline]
            for n in child.nodes:
                if n.kind == "INPUT":
                    self.conform(_declared(n.payload.schema), inputs[n.name], node, f"{node.name}.{n.name}")
                elif n.kind == "OUTPUT":
                    self.ports[pipe.name, node.name, n.name] = self.schemas[child.name, n.name]
            return None
        if node.kind == "JOIN":
            return self.join(p, inputs["left"], inputs["right"], node)
        return OPERATIONS[node.kind](self, p, inputs[None])

    def conform(self, expected: Schema, actual: Schema, node: Node, label: str) -> None:
        if expected is None or actual is None:
            return
        names = [c.name for c in expected]
        if names != [c.name for c in actual]:
            self.error("E_SCHEMA", f"{label}: se esperaba {names}, se obtuvo {[c.name for c in actual]}.", node)
            return
        for want, got in zip(expected, actual):
            if not _accepts(want.type, got.type):
                self.error("E_TYPE", f"{label}: {want.name}: se esperaba {_name(want.type)}, "
                                     f"se obtuvo {_name(got.type)}.", node)

    def require(self, schema: Schema, names, node: a.Node) -> bool:
        if schema is None:
            return True
        available = [c.name for c in schema]
        missing = [name for name in names if name not in available]
        if missing:
            self.error("E_COLUMN", f"Columnas inexistentes: {missing}; disponibles: {available}.", node)
        return not missing

    def distinct_names(self, schema: Schema, node: a.Node | Node) -> Schema:
        """Rechaza nombres repetidos, también si solo difieren en mayúsculas, como el runtime."""
        if schema is None:
            return None
        seen = {}
        for col in schema:
            key = col.name.casefold()
            if key in seen:
                self.error("E_AMBIGUOUS_COLUMNS", f"Nombres de salida ambiguos: {seen[key]} y {col.name}.", node)
                return None
            seen[key] = col.name
        return schema

    # Operaciones. Si una operación tiene errores, su salida queda desconocida (None)
    # para no repetir el mismo problema en cada paso posterior.

    def filter(self, op: a.Filter, schema: Schema) -> Schema:
        typed = self.expr(op.predicate, schema)
        if typed.type not in (None, T.BOOL):
            self.error("E_TYPE", f"WHERE requiere una condición BOOL; {expr_text(op.predicate)} es "
                                 f"{_name(typed.type)}.", op.predicate)
            return None
        return schema

    def select(self, op: a.Select | a.Distinct, schema: Schema) -> Schema:
        if schema is None:
            return tuple(Col(name, None) for name in op.columns)
        if not self.require(schema, op.columns, op):
            return None
        by_name = {c.name: c for c in schema}
        return tuple(by_name[name] for name in op.columns)

    def drop_nulls(self, op: a.DropNulls, schema: Schema) -> Schema:
        if schema is None or not self.require(schema, op.columns, op):
            return None
        return tuple(replace(c, nullable=False) if c.name in op.columns else c for c in schema)

    def derive(self, op: a.Derive, schema: Schema) -> Schema:
        new = []
        ok = True
        for item in op.assignments:
            typed = self.expr(item.expression, schema)
            if schema is not None and item.name in {c.name for c in schema}:
                self.error("E_DUPLICATE_COLUMN", f"DERIVE crea columnas nuevas y {item.name} ya existe; "
                                                 "para reemplazar nulos use FILL_NULL.", item)
                ok = False
            new.append(Col(item.name, typed.type, typed.nullable))
        if schema is None or not ok:
            return None
        return self.distinct_names(schema + tuple(new), op)

    def fill_null(self, op: a.FillNull, schema: Schema) -> Schema:
        if schema is None:
            for item in op.assignments:
                self.expr(item.expression, None)
            return None
        if not self.require(schema, [item.name for item in op.assignments], op):
            return None
        by_name = {c.name: c for c in schema}
        ok = True
        for item in op.assignments:
            col, typed = by_name[item.name], self.expr(item.expression, schema)
            if not _compatible(col.type, typed.type):
                self.error("E_TYPE", f"FILL_NULL: {item.name} es {_name(col.type)} y el valor es "
                                     f"{_name(typed.type)}.", item.expression)
                ok = False
                continue
            result = _numeric_result(col.type, typed.type) if col.type in NUMERIC else col.type
            by_name[item.name] = Col(col.name, result, col.nullable and typed.nullable)
        return tuple(by_name[c.name] for c in schema) if ok else None

    def aggregate(self, op: a.Aggregate, schema: Schema) -> Schema:
        if not self.require(schema, op.group_by, op):
            return None
        by_name = {} if schema is None else {c.name: c for c in schema}
        columns = [by_name.get(name, Col(name, None)) for name in op.group_by]
        ok = True
        for item in op.aggregations:
            if item.function == "COUNT":
                if item.expression is not None:
                    self.expr(item.expression, schema)
                columns.append(Col(item.alias, T.INT, False))
                continue
            typed = self.expr(item.expression, schema)
            # Sin GROUP_BY una tabla vacía da NULL; con grupos, solo un grupo sin valores.
            nullable = typed.nullable or not op.group_by
            if item.function in {"SUM", "AVG"}:
                if typed.type is not None and typed.type not in NUMERIC:
                    self.error("E_TYPE", f"{item.function} requiere números; {expr_text(item.expression)} "
                                         f"es {_name(typed.type)}.", item.expression)
                    ok = False
                    continue
                result = T.DECIMAL if item.function == "AVG" else typed.type
            else:
                result = typed.type
            columns.append(Col(item.alias, result, nullable))
        return self.distinct_names(tuple(columns), op) if ok else None

    def sort(self, op: a.Sort, schema: Schema) -> Schema:
        return schema if self.require(schema, [k.name for k in op.keys], op) else None

    def rename(self, op: a.Rename, schema: Schema) -> Schema:
        if schema is None or not self.require(schema, [i.name for i in op.items], op):
            return None
        mapping = {i.name: i.alias for i in op.items}
        return self.distinct_names(tuple(replace(c, name=mapping.get(c.name, c.name)) for c in schema), op)

    def join(self, op: a.Join, left: Schema, right: Schema, node: Node) -> Schema:
        sides = {"left": left, "right": right}
        ok = True
        for cond in op.conditions:
            types = []
            for column in (cond.left, cond.right):
                typed = self.column(column, sides[column.qualifier])
                ok = ok and typed is not None
                types.append((typed or UNKNOWN).type)
            if not _compatible(*types):
                self.error("E_TYPE", f"JOIN compara {expr_text(cond.left)} ({_name(types[0])}) con "
                                     f"{expr_text(cond.right)} ({_name(types[1])}).", cond)
                ok = False
        if left is None or right is None or not ok:
            return None
        nullable_left, nullable_right = op.kind in {"RIGHT", "FULL"}, op.kind in {"LEFT", "FULL"}
        columns = (tuple(replace(c, nullable=c.nullable or nullable_left) for c in left) +
                   tuple(replace(c, nullable=c.nullable or nullable_right) for c in right))
        return self.distinct_names(columns, node)

    # Expresiones

    def column(self, node: a.Column, schema: Schema) -> Typed | None:
        """Tipo de una columna; None si no existe (el error ya se reportó)."""
        if schema is None:
            return UNKNOWN
        for col in schema:
            if col.name == node.name:
                return Typed(col.type, col.nullable)
        self.error("E_COLUMN", f"Columna inexistente: {node.name}; disponibles: {[c.name for c in schema]}.", node)
        return None

    def expr(self, node: a.Expr, schema: Schema) -> Typed:
        if isinstance(node, a.Literal):
            return _literal(node.value)
        if isinstance(node, a.Column):
            if node.qualifier is not None:
                self.error("E_QUALIFIER", "Solo las condiciones de JOIN admiten calificadores left/right.", node)
                return UNKNOWN
            return self.column(node, schema) or UNKNOWN
        if isinstance(node, a.UnaryExpr):
            operand = self.expr(node.operand, schema)
            if node.operator in {"IS NULL", "IS NOT NULL"}:
                return Typed(T.BOOL, False)
            if node.operator == "NOT":
                return self.operands(node, "NOT", [operand], BOOLEAN, T.BOOL)
            return self.operands(node, "-", [operand], NUMERIC, operand.type)
        if isinstance(node, a.BinaryExpr):
            left, right = self.expr(node.left, schema), self.expr(node.right, schema)
            if node.operator in {"AND", "OR"}:
                return self.operands(node, node.operator, [left, right], BOOLEAN, T.BOOL)
            if node.operator in {"+", "-", "*", "/"}:
                result = T.DECIMAL if node.operator == "/" else _numeric_result(left.type, right.type)
                return self.operands(node, node.operator, [left, right], NUMERIC, result)
            if not _compatible(left.type, right.type):
                self.error("E_TYPE", f"No se puede comparar {_name(left.type)} con {_name(right.type)} "
                                     f"en {expr_text(node)}.", node)
                return UNKNOWN
            return Typed(T.BOOL, left.nullable or right.nullable)
        return self.call(node, [self.expr(arg, schema) for arg in node.arguments])

    def operands(self, node: a.Expr, operator: str, operands: list[Typed],
                 expected: frozenset, result: ScalarType | None) -> Typed:
        wrong = [o.type for o in operands if o.type is not None and o.type not in expected]
        if wrong:
            names = " o ".join(sorted(t.value for t in expected))
            self.error("E_TYPE", f"{operator} requiere {names}; se obtuvo {_name(wrong[0])} "
                                 f"en {expr_text(node)}.", node)
            return UNKNOWN
        return Typed(result, any(o.nullable for o in operands))

    def call(self, node: a.Call, args: list[Typed]) -> Typed:
        name = node.name
        if name in {"LOWER", "UPPER", "TRIM"}:
            return self.operands(node, name, args, TEXT, T.STRING)
        if name == "SAFE_DIVIDE":
            return replace(self.operands(node, name, args, NUMERIC, T.DECIMAL), nullable=True)
        known = [arg.type for arg in args if arg.type is not None]
        if any(not _compatible(known[0], t) for t in known[1:]):
            self.error("E_TYPE", f"{name} recibe tipos incompatibles: "
                                 f"{', '.join(_name(t) for t in known)}.", node)
            return UNKNOWN
        if name == "NULLIF":
            return Typed(args[0].type, True)
        # COALESCE: el tipo se conoce si se conocen todos; es nulo solo si todos pueden serlo.
        if not known or len(known) < len(args):
            result = None
        elif known[0] in NUMERIC:
            result = _numeric_result(*known)
        else:
            result = known[0]
        return Typed(result, all(arg.nullable for arg in args))


def _literal(value) -> Typed:
    if value is None:
        return UNKNOWN
    if isinstance(value, bool):
        return Typed(T.BOOL, False)
    if isinstance(value, int):
        return Typed(T.INT, False)
    if isinstance(value, str):
        return Typed(T.STRING, False)
    return Typed(T.DECIMAL, False)


OPERATIONS = {"FILTER": Checker.filter, "SELECT": Checker.select, "DISTINCT": Checker.select,
              "DROP_NULLS": Checker.drop_nulls, "DERIVE": Checker.derive, "FILL_NULL": Checker.fill_null,
              "AGGREGATE": Checker.aggregate, "SORT": Checker.sort, "RENAME": Checker.rename}


def check(module: Module) -> TypeInfo:
    """Esquemas de salida de cada nodo y diagnósticos de tipos."""
    return Checker(module).run()
