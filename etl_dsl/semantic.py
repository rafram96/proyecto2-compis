"""Análisis abstracto sin motor ni IO. Solo rechaza incompatibilidades demostradas."""
from dataclasses import dataclass, replace
from decimal import Decimal
from itertools import product

from . import ast as a
from .diagnostics import Diagnostic

NUMERIC = frozenset({'INT', 'REAL', 'FIXED'})
SCALARS = NUMERIC | {'STRING', 'BOOL', 'DATE', 'DATETIME'}
FAMILIES = {'DECIMAL': NUMERIC, **{t: frozenset({t}) for t in ('INT', 'STRING', 'BOOL', 'DATE', 'DATETIME')}}


@dataclass(frozen=True)
class Value:
    # None: tipo desconocido; conjunto vacío: tipo Null de Polars.
    types: frozenset[str] | None = None
    nullable: bool = True  # puede contener NULL; no afirma que exista una fila nula


@dataclass(frozen=True)
class Schema:
    columns: tuple[tuple[str, Value], ...] = ()
    complete: bool = False  # False: puede haber otras columnas, en posiciones desconocidas

    absent: frozenset[str] = frozenset()  # nombres demostrablemente ausentes

    def get(self, name):
        return dict(self.columns).get(name)

    def update(self, values):
        return Schema(tuple((n, values.get(n, v)) for n, v in self.columns) +
                      tuple((n, v) for n, v in values.items() if self.get(n) is None), self.complete, self.absent.difference(values))

    def to_dict(self):
        return {'complete': self.complete, 'absent': sorted(self.absent), 'columns': [
            {'name': n, 'types': sorted(v.types) if v.types is not None else None,
             'nullable': v.nullable} for n, v in self.columns]}


def declared(schema):
    if schema is None or schema.fields is None:
        return Schema()
    return Schema(tuple((f.name, Value(FAMILIES[f.type.value], f.nullable)) for f in schema.fields), True)


def common(left, right):
    """Supertipo de Polars para COALESCE; no implica igualdad estricta de tipos."""
    if left.types is None or right.types is None:
        types = None
    elif not left.types:
        types = right.types
    elif not right.types:
        types = left.types
    else:
        def merge(x, y):
            if x == y:
                return x
            if 'STRING' in (x, y):
                return 'STRING'
            if x in NUMERIC | {'BOOL'} and y in NUMERIC | {'BOOL'}:
                return 'REAL' if 'REAL' in (x, y) else 'FIXED' if 'FIXED' in (x, y) else 'INT'
            if {x, y} <= {'DATE', 'DATETIME'}:
                return 'DATETIME'
            if (x in NUMERIC and y in {'DATE', 'DATETIME'}) or (y in NUMERIC and x in {'DATE', 'DATETIME'}):
                return x if x in NUMERIC else y
            return None
        merged = {merge(x, y) for x, y in product(left.types, right.types)}
        types = None if None in merged else frozenset(merged)
    return Value(types, left.nullable and right.nullable)


class Analyzer:
    def __init__(self, module):
        self.pipelines = {p.name: p for p in module.pipelines}
        self.issues = []
        self.schemas = {}
        self.outputs = {}

    def error(self, code, message, node):
        span = node.span
        issue = Diagnostic(code, message, span, phase='semantic')
        if issue not in self.issues:
            self.issues.append(issue)

    def column(self, schema, name, owner):
        value = schema.get(name)
        if value is None:
            if schema.complete or name in schema.absent:
                self.error('E_COLUMN', f'Columna inexistente: {name}.', name if hasattr(name, 'span') else owner)
            return Value()
        return value

    def require(self, value, allowed, owner, description):
        if value.types and not value.types & allowed:
            self.error('E_TYPE', f'{description}: tipo incompatible ({", ".join(sorted(value.types))}).', owner)

    def compatible(self, left, right, owner, *, join=False):
        if not left.types or not right.types:
            return
        valid = any(x == y or (not join and x in NUMERIC and y in NUMERIC) or
                    (not join and ({x, y} <= NUMERIC | {'BOOL', 'DATE', 'DATETIME'} or
                                   {x, y} <= {'STRING', 'BOOL'}))
                    for x, y in product(left.types, right.types))
        if not valid:
            self.error('E_TYPE', 'Los operandos tienen tipos incompatibles.', owner)

    def expr(self, expr, schema):
        if isinstance(expr, a.Column):
            if expr.qualifier:
                self.error('E_QUALIFIER', 'Solo JOIN admite calificadores left/right.', expr)
            return self.column(schema, expr.name, expr)
        if isinstance(expr, a.Literal):
            x = expr.value
            t = None if x is None else 'BOOL' if isinstance(x, bool) else 'INT' if isinstance(x, int) else 'FIXED' if isinstance(x, Decimal) else 'STRING'
            return Value(frozenset({t}) if t else frozenset(), x is None)
        if isinstance(expr, a.UnaryExpr):
            v = self.expr(expr.operand, schema)
            if expr.operator in {'IS NULL', 'IS NOT NULL'}:
                return Value(frozenset({'BOOL'}), False)
            self.require(v, {'BOOL'} if expr.operator == 'NOT' else NUMERIC | {'DURATION'}, expr.operand, expr.operator)
            if v.types == frozenset():
                self.error('E_TYPE', f'{expr.operator} no admite un operando de tipo Null.', expr)
            return Value(frozenset({'BOOL'}) if expr.operator == 'NOT' else v.types, v.nullable)
        if isinstance(expr, a.BinaryExpr):
            l, r = self.expr(expr.left, schema), self.expr(expr.right, schema)
            op = expr.operator
            if op in {'AND', 'OR'}:
                for v, child in ((l, expr.left), (r, expr.right)):
                    self.require(v, {'BOOL'}, child, op)
                return Value(frozenset({'BOOL'}), l.nullable or r.nullable)
            if op in {'==', '!=', '<', '<=', '>', '>='}:
                self.compatible(l, r, expr)
                return Value(frozenset({'BOOL'}), l.nullable or r.nullable)
            types = self.arithmetic(l, r, op, expr)
            return Value(types, l.nullable or r.nullable)
        args = [self.expr(arg, schema) for arg in expr.arguments]
        if expr.name in {'LOWER', 'UPPER', 'TRIM'}:
            self.require(args[0], {'STRING'}, expr.arguments[0], expr.name)
            if args[0].types == frozenset():
                self.error('E_TYPE', f'{expr.name} requiere STRING; NULL tiene tipo Null.', expr.arguments[0])
            return Value(frozenset({'STRING'}), args[0].nullable)
        if expr.name == 'NULLIF':
            self.compatible(*args, expr)
            return replace(args[0], nullable=True)
        if expr.name == 'SAFE_DIVIDE':
            for v, child in zip(args, expr.arguments):
                self.require(v, NUMERIC | {'BOOL', 'DURATION'}, child, expr.name)
            return Value(self.arithmetic(*args, '/', expr), True)
        result = args[0]
        for v in args[1:]:
            result = self.coalesce(result, v, expr)
        return result

    def coalesce(self, left, right, owner):
        result = common(left, right)
        if left.types and right.types and result.types is None:
            possible = any(common(Value(frozenset({x})), Value(frozenset({y}))).types is not None
                           for x, y in product(left.types, right.types))
            if not possible and left.types | right.types <= SCALARS:
                self.error('E_TYPE', 'No existe un tipo común para COALESCE/FILL_NULL.', owner)
        return result

    def arithmetic(self, left, right, op, owner):
        if left.types is None or right.types is None:
            # Un operando desconocido no legitima el otro: no obstante puede ser
            # Duration (temporal) u otro dtype no expresable en el DSL.
            return None
        def result(x, y):
            if x in NUMERIC | {'BOOL'} and y in NUMERIC | {'BOOL'}:
                if x == y == 'BOOL' and op in {'-', '*'}:
                    return None
                t = next(iter(common(Value(frozenset({x})), Value(frozenset({y}))).types))
                if t == 'BOOL':
                    t = 'INT'
                return 'REAL' if op == '/' and t == 'INT' else t
            if op == '+' and {x, y} <= {'STRING', 'BOOL'} and 'STRING' in (x, y):
                return 'STRING'
            if op == '-' and {x, y} <= {'DATE', 'DATETIME'}:
                return 'DURATION'
            # Duration no puede declararse pero sí resultar de una resta temporal.
            if x == 'DURATION' or y == 'DURATION':
                return 'UNKNOWN'
            return None
        if not left.types and not right.types:
            return frozenset({'REAL'}) if op == '/' else frozenset()
        if not left.types or not right.types:
            other = left.types or right.types
            possible = {result(t, t) if t not in {'DATE', 'DATETIME'} else 'UNKNOWN'
                        for t in other} - {None}
        else:
            possible = {result(x, y) for x, y in product(left.types, right.types)} - {None}
        if not possible:
            self.error('E_TYPE', f'Operandos incompatibles para {op}.', owner)
        return None if 'UNKNOWN' in possible else frozenset(possible) if possible else None

    def unique(self, schema, owner):
        names = [n.casefold() for n, _ in schema.columns]
        if len(set(names)) != len(names):
            self.error('E_AMBIGUOUS_COLUMNS', 'Nombres de salida ambiguos (sin distinguir mayúsculas).', owner)
        return schema

    def contract(self, actual, contract, owner):
        expected = declared(contract)
        if not expected.complete:
            return actual
        names = [n for n, _ in actual.columns]
        wanted = [n for n, _ in expected.columns]
        if ((actual.complete and names != wanted) or any(n not in wanted for n in names)
                or any(n in actual.absent for n in wanted)):
            self.error('E_SCHEMA', f'Contrato incompatible: se esperaba {wanted}; se conoce {names}.', owner)
        values = {}
        for field in contract.fields:
            v = actual.get(field.name)
            if v is not None:
                if v.types is not None and not v.types & FAMILIES[field.type.value]:
                    # Null es un dtype incompatible con todo contrato escalar, incluso nullable.
                    self.error('E_TYPE', f'Contrato incompatible para {field.name}: se esperaba {field.type.value}.', field)
                types = FAMILIES[field.type.value] if v.types is None else v.types & FAMILIES[field.type.value]
                values[field.name] = Value(types, v.nullable and field.nullable)
            else:
                values[field.name] = dict(expected.columns)[field.name]
        # El contrato comprueba los nulos en ejecución; nullable=True no prueba que existan.
        return self.unique(Schema(tuple(values.items()), True), owner)

    def nonnull(self, predicate, truth=True):
        """Columnas necesariamente no nulas al obtener TRUE (o FALSE bajo NOT)."""
        if isinstance(predicate, a.Column):
            return {predicate.name}
        if isinstance(predicate, a.UnaryExpr):
            if predicate.operator == 'NOT':
                return self.nonnull(predicate.operand, not truth)
            excludes_null = (predicate.operator == 'IS NOT NULL' and truth or
                             predicate.operator == 'IS NULL' and not truth)
            if excludes_null and isinstance(predicate.operand, a.Column):
                return {predicate.operand.name}
        if isinstance(predicate, a.BinaryExpr):
            l = self.nonnull(predicate.left, truth)
            r = self.nonnull(predicate.right, truth)
            if predicate.operator in {'AND', 'OR'}:
                both_required = predicate.operator == 'AND' if truth else predicate.operator == 'OR'
                return l | r if both_required else l & r
            if predicate.operator in {'==', '!=', '<', '>', '<=', '>='}:
                return {x.name for x in (predicate.left, predicate.right) if isinstance(x, a.Column)}
        return set()

    def operation(self, node, inputs):
        p = node.payload
        s = inputs.get(None, Schema())
        if node.kind == "CHECK_JOIN":
            return inputs["left"]
        if isinstance(p, a.Join):
            left, right = inputs['left'], inputs['right']
            keys = {'left': set(), 'right': set()}
            for c in p.conditions:
                vals = []
                for col in (c.left, c.right):
                    vals.append(self.column(inputs[col.qualifier], col.name, col))
                    keys[col.qualifier].add(col.name)
                self.compatible(*vals, c, join=True)
            def side(schema, label):
                outer = p.kind == 'FULL' or (label == 'left' and p.kind == 'RIGHT') or (label == 'right' and p.kind == 'LEFT')
                return tuple((n, replace(v, nullable=True) if outer else replace(v, nullable=False)
                              if p.kind == 'INNER' and n in keys[label] else v) for n, v in schema.columns)
            return self.unique(Schema(side(left, 'left') + side(right, 'right'), left.complete and right.complete), p)
        if isinstance(p, a.Filter):
            v = self.expr(p.predicate, s)
            self.require(v, {'BOOL'}, p.predicate, 'WHERE requiere un predicado booleano')
            if v.types == frozenset():
                self.error('E_TYPE', 'WHERE requiere BOOL; NULL tiene tipo Null.', p.predicate)
            names = self.nonnull(p.predicate)
            return s.update({n: replace(s.get(n) or Value(), nullable=False) for n in names})
        if isinstance(p, (a.Select, a.Distinct)):
            return self.unique(Schema(tuple((n, self.column(s, n, p)) for n in p.columns), True), p)
        if isinstance(p, a.DropNulls):
            return s.update({n: replace(self.column(s, n, p), nullable=False) for n in p.columns})
        if isinstance(p, a.Sort):
            for key in p.keys:
                self.column(s, key.name, key)
            return s
        if isinstance(p, a.Rename):
            mapping = {i.name: i.alias for i in p.items}
            extra = []
            for i in p.items:
                v = self.column(s, i.name, i)
                if s.get(i.name) is None and not s.complete:
                    extra.append((i.alias, v))
            return self.unique(Schema(tuple((mapping.get(n, n), v) for n, v in s.columns) + tuple(extra), s.complete, frozenset((s.absent | mapping.keys()) - set(mapping.values()))), p)
        if isinstance(p, (a.Derive, a.FillNull)):
            values = {}
            scope = replace(s, absent=s.absent | frozenset(i.name for i in p.assignments)) if isinstance(p, a.Derive) else s
            for item in p.assignments:
                v = self.expr(item.expression, scope)
                if isinstance(p, a.FillNull):
                    v = self.coalesce(self.column(s, item.name, item), v, item.expression)
                elif any(n.casefold() == item.name.casefold() for n, _ in s.columns):
                    self.error('E_AMBIGUOUS_COLUMNS', f'DERIVE requiere una columna nueva: {item.name}.', item)
                values[item.name] = v
            return self.unique(s.update(values), p)
        if isinstance(p, a.Aggregate):
            cols = [(n, self.column(s, n, p)) for n in p.group_by]
            for agg in p.aggregations:
                v = self.expr(agg.expression, s) if agg.expression is not None else Value()
                if agg.function == 'COUNT':
                    v = Value(frozenset({'INT'}), False)
                else:
                    if agg.function in {'SUM', 'AVG'}:
                        # SUM(Boolean) es entero; AVG(Boolean) es real en Polars.
                        self.require(v, NUMERIC | {'BOOL'} | ({'DATE', 'DATETIME', 'DURATION'} if agg.function == 'AVG' else {'DURATION'}), agg.expression, agg.function)
                    if agg.function == 'AVG':
                        types = None if v.types is None else frozenset('DATETIME' if t == 'DATE' else t if t in {'DATETIME', 'DURATION'} else 'REAL' for t in v.types)
                    elif agg.function == 'SUM' and v.types is not None:
                        types = frozenset('INT' if t == 'BOOL' else t for t in v.types)
                    else:
                        types = v.types
                    v = Value(types, v.nullable or not p.group_by)
                cols.append((agg.alias, v))
            return self.unique(Schema(tuple(cols), True), p)
        raise AssertionError(f'Operación sin semántica: {node.kind}')

    def pipeline(self, name, bindings=None):
        if bindings is None and name in self.outputs:
            return self.outputs[name]
        pipe = self.pipelines[name]
        values, outputs, exposed = {}, {}, {}
        for node in pipe.nodes:
            p = node.payload
            inputs = {port: values[(ref.node, ref.port)] for port, ref in node.inputs}
            if node.kind in {'SOURCE', 'INPUT'}:
                s = self.unique(declared(p.schema), p)
                if node.kind == 'INPUT' and bindings is not None:
                    s = bindings[node.name]
            elif node.kind == 'USE':
                self.pipeline(p.pipeline)
                bound = {}
                for target in self.pipelines[p.pipeline].nodes:
                    if target.kind == 'INPUT':
                        bound[target.name] = self.contract(inputs[target.name], target.payload.schema, p)
                target_outputs = self.pipeline(p.pipeline, bound)
                for port, schema in target_outputs.items():
                    values[(node.name, port)] = schema
                exposed[node.name] = {port: schema.to_dict() for port, schema in target_outputs.items()}
                continue
            elif node.kind in {'OUTPUT', 'SINK'}:
                s = inputs[None]
                if node.kind == 'OUTPUT':
                    s = self.contract(s, p.schema, p)
                    outputs[node.name] = s
            else:
                s = self.operation(node, inputs)
            values[(node.name, None)] = s
            exposed[node.name] = {"": s.to_dict()}
        if bindings is None:
            self.schemas[name] = exposed
            self.outputs[name] = outputs
        return outputs


def infer(module):
    """IR original -> diagnósticos y esquemas por pipeline/nodo/puerto de salida.

    Una instancia se verifica contra INPUT; sus salidas usan el resumen del pipeline,
    especializado con las entradas de cada instancia. El contrato nunca convierte tipos.
    """
    analyzer = Analyzer(module)
    for pipe in module.pipelines:
        analyzer.pipeline(pipe.name)
    return tuple(analyzer.issues), analyzer.schemas
