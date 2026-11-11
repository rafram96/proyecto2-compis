"""Hechos conservadores y eliminación de predicados implicados (O1).

No evalúa datasets ni expresiones aritméticas. Los intervalos describen valores
no nulos; para demostrar un predicado también se exige ausencia de NULL.
"""
from dataclasses import dataclass, replace

from . import ast as a
from .semantic import NUMERIC, infer
from .token import Span

# C2 distingue familias, sin anchos: REAL puede ser Float16/32/64. Sus
# umbrales deben ser exactos en el formato más estrecho. Los INT no pasan
# por float y admiten literales del rango firmado de 64 bits.
MAX_EXACT = 2**11 - 1
MAX_INTEGER = 2**63 - 1


@dataclass(frozen=True)
class Evidence:
    pipeline: str
    node: str
    condition: str
    span: Span


@dataclass(frozen=True)
class Bound:
    value: int
    inclusive: bool
    evidence: tuple[Evidence, ...]


@dataclass(frozen=True)
class ColumnFact:
    name: str
    lower: Bound | None = None
    upper: Bound | None = None
    nullable: bool = True
    null_only: bool = False
    evidence: tuple[Evidence, ...] = ()

    @property
    def inconsistent(self):
        if self.null_only and not self.nullable:
            return True
        if self.lower is None or self.upper is None:
            return False
        return (self.lower.value > self.upper.value or
                self.lower.value == self.upper.value and
                not (self.lower.inclusive and self.upper.inclusive))


@dataclass(frozen=True)
class NodeFacts:
    pipeline: str
    node: str
    columns: tuple[ColumnFact, ...]
    contradictory: bool = False


@dataclass(frozen=True)
class RangeRewrite:
    pipeline: str
    node: str
    action: str  # remove_filter o simplify_predicate
    before: str
    after: str | None
    span: Span
    reason: str
    proof: tuple[ColumnFact, ...]
    origin: tuple[str, ...]
    consumers: tuple[str, ...]


def integer(expr):
    if isinstance(expr, a.UnaryExpr) and expr.operator == '-':
        value = integer(expr.operand)
        return -value if value is not None else None
    if isinstance(expr, a.Literal) and type(expr.value) is int and abs(expr.value) <= MAX_INTEGER:
        return expr.value
    return None


def atom(expr, schema):
    """(columna, operador, umbral) únicamente para expresiones cuyo tipo es seguro."""
    if isinstance(expr, a.UnaryExpr) and expr.operator in {'IS NULL', 'IS NOT NULL'}:
        if isinstance(expr.operand, a.Column) and not expr.operand.qualifier:
            return expr.operand.name, expr.operator, None
    if not isinstance(expr, a.BinaryExpr) or expr.operator not in {'>', '>=', '<', '<=', '==', '!='}:
        return None
    left, right, op = expr.left, expr.right, expr.operator
    if isinstance(right, a.Column):
        left, right = right, left
        op = {'>': '<', '>=': '<=', '<': '>', '<=': '>=', '==': '==', '!=': '!='}[op]
    value = integer(right)
    if not isinstance(left, a.Column) or left.qualifier or value is None:
        return None
    column = next((c for c in schema['columns'] if c['name'] == left.name), None)
    if column is None or not column['types'] or not set(column['types']) <= NUMERIC:
        return None
    if 'REAL' in column['types'] and abs(value) > MAX_EXACT:
        return None
    return left.name, op, value


def implies(fact, op, value):
    if op == 'IS NULL':
        return fact.null_only
    if op == 'IS NOT NULL':
        return not fact.nullable
    if fact.nullable or fact.null_only or fact.inconsistent:
        return False
    lo, hi = fact.lower, fact.upper
    lower = lo is not None and (lo.value > value or lo.value == value and not lo.inclusive)
    upper = hi is not None and (hi.value < value or hi.value == value and not hi.inclusive)
    if op == '>':
        return lower
    if op == '>=':
        return lo is not None and lo.value >= value
    if op == '<':
        return upper
    if op == '<=':
        return hi is not None and hi.value <= value
    if op == '==':
        return (lo is not None and hi is not None and lo.inclusive and hi.inclusive and
                lo.value == hi.value == value)
    return lower or upper  # !=, sin dominio de agujeros


def constrain(fact, op, value, evidence):
    origins = fact.evidence + (evidence,)
    if op == 'IS NULL':
        return replace(fact, null_only=True, evidence=origins)
    result = replace(fact, nullable=False, evidence=origins)
    if op == 'IS NOT NULL':
        return result
    bound = Bound(value, op in {'>=', '<=', '=='}, (evidence,))
    if op in {'>', '>=', '=='}:
        old = result.lower
        if old is None or bound.value > old.value or bound.value == old.value and not bound.inclusive:
            result = replace(result, lower=bound)
    if op in {'<', '<=', '=='}:
        old = result.upper
        if old is None or bound.value < old.value or bound.value == old.value and not bound.inclusive:
            result = replace(result, upper=bound)
    return result


def simplify(expr, facts, schema, evidence_for):
    """Aprende AND de izquierda a derecha. OR/NOT y llamadas se conservan enteros."""
    if isinstance(expr, a.BinaryExpr) and expr.operator == 'AND':
        left, facts, proofs = simplify(expr.left, facts, schema, evidence_for)
        right, facts, more = simplify(expr.right, facts, schema, evidence_for)
        result = right if left is None else left if right is None else replace(expr, left=left, right=right)
        return result, facts, proofs + more
    constraint = atom(expr, schema)
    if constraint is None:
        return expr, facts, ()
    name, op, value = constraint
    fact = facts.get(name, ColumnFact(name))
    if implies(fact, op, value):
        return None, facts, (fact,)
    updated = dict(facts)
    updated[name] = constrain(fact, op, value, evidence_for(expr))
    return expr, updated, ()


def ranges(module):
    """Pase rangos; anota sus hechos y pruebas en la IR sin modificar el AST."""
    from .ir import expr_text
    from .passes import _bypass

    issues, schemas = infer(module)
    if issues:
        return module  # La ruta pública comprueba C2 antes de cualquier pase.
    pipelines, snapshots, rewrites = [], [], []
    for pipe in module.pipelines:
        states, nodes, removed = {}, [], {}
        for node in pipe.nodes:
            evidence = Evidence(pipe.name, node.name, node.kind, node.span)
            outputs = schemas[pipe.name][node.name]
            incoming = {port: states[(ref.node, ref.port)] for port, ref in node.inputs}
            if node.kind == 'USE':
                # Las llamadas conservan sus contratos y sus efectos. No se pasan
                # garantías de una instancia a otra ni se omiten INPUT/OUTPUT.
                for port, schema in outputs.items():
                    cols = initial(schema, evidence)
                    states[(node.name, port)] = cols, False
                    snapshots.append(NodeFacts(pipe.name, node.name + '.' + port, tuple(cols.values())))
                nodes.append(node)
                continue
            schema = outputs['']
            facts, contradictory = incoming.get(None, ({}, False))
            facts = dict(facts)
            p = node.payload
            if node.kind in {'SOURCE', 'INPUT', 'JOIN', 'AGGREGATE'}:
                facts, contradictory = initial(schema, evidence), False
            elif node.kind == 'FILTER':
                before = expr_text(p.predicate)
                input_ref = node.input()
                input_schema = schemas[pipe.name][input_ref.node][input_ref.port or '']
                pred, learned, proofs = simplify(
                    p.predicate, facts, input_schema,
                    lambda expr: Evidence(pipe.name, node.name, expr_text(expr), expr.span))
                # Nunca usar contradicciones para demostrar cualquier predicado.
                contradictory = contradictory or any(f.inconsistent for f in learned.values())
                facts = learned
                if proofs and not contradictory:
                    action = 'remove_filter' if pred is None else 'simplify_predicate'
                    rewrites.append(RangeRewrite(
                        pipe.name, node.name, action, before,
                        None if pred is None else expr_text(pred), p.predicate.span,
                        'Los hechos previos y los términos conservados del AND implican el predicado eliminado.', proofs,
                        node.origin, tuple(n.name for n in pipe.nodes if any(
                            ref.node == node.name for _, ref in n.inputs)) if pred is None else ()))
                    if pred is None:
                        removed[node.name] = node.input()
                    else:
                        node = replace(node, payload=replace(p, predicate=pred))
            elif node.kind in {'SELECT', 'DISTINCT'}:
                facts = {n: facts.get(n, ColumnFact(n)) for n in p.columns}
            elif node.kind == 'RENAME':
                mapping = {i.name: i.alias for i in p.items}
                facts = {mapping.get(n, n): replace(f, name=mapping.get(n, n)) for n, f in facts.items()}
            elif node.kind in {'DERIVE', 'FILL_NULL'}:
                original = dict(facts)
                for assignment in p.assignments:
                    # Incluso si un backend futuro permite sustituir columnas,
                    # una asignación invalida sus rangos antes de aprender otros.
                    facts.pop(assignment.name, None)
                    if node.kind == 'DERIVE':
                        value = integer(assignment.expression)
                        why = Evidence(pipe.name, node.name, expr_text(assignment.expression), assignment.expression.span)
                        if value is not None:
                            bound = Bound(value, True, (why,))
                            facts[assignment.name] = ColumnFact(assignment.name, bound, bound, False, evidence=(why,))
                        elif isinstance(assignment.expression, a.Column) and assignment.expression.name in original:
                            facts[assignment.name] = replace(original[assignment.expression.name], name=assignment.name)
                        elif isinstance(assignment.expression, a.Literal) and assignment.expression.value is None:
                            facts[assignment.name] = ColumnFact(assignment.name, null_only=True, evidence=(why,))
            elif node.kind == 'DROP_NULLS':
                for name in p.columns:
                    fact = facts.get(name, ColumnFact(name))
                    facts[name] = replace(fact, nullable=False, evidence=fact.evidence + (evidence,))
                    contradictory |= facts[name].inconsistent
            # SORT/OUTPUT/SINK conservan los valores. C2 aporta las garantías de
            # nulabilidad, también para predicados fuera del fragmento de rangos.
            for column in schema['columns']:
                name = column['name']
                fact = facts.get(name, ColumnFact(name))
                if not column['nullable'] and fact.nullable:
                    fact = replace(fact, nullable=False, evidence=fact.evidence + (evidence,))
                facts[name] = fact
            states[(node.name, None)] = facts, contradictory
            if node.name not in removed:
                snapshots.append(NodeFacts(pipe.name, node.name, tuple(facts.values()), contradictory))
            nodes.append(node)
        pipelines.append(_bypass(replace(pipe, nodes=tuple(nodes)), removed))
    return replace(module, pipelines=tuple(pipelines), range_facts=tuple(snapshots),
                   range_rewrites=module.range_rewrites + tuple(rewrites))


def initial(schema, evidence):
    return {c['name']: ColumnFact(c['name'], nullable=c['nullable'],
                                  evidence=(evidence,) if not c['nullable'] else ())
            for c in schema['columns']}
