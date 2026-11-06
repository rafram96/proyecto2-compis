"""Validaciones independientes del motor de ejecución y de los datos externos.

No infiere esquemas ni comprueba tipos de expresiones/columnas.
"""
from collections import Counter, defaultdict
from graphlib import CycleError, TopologicalSorter

from . import ast as a
from .diagnostics import Diagnostic
from .visitor import walk


def validate(program: a.Program) -> tuple[Diagnostic, ...]:
    """Comprueba nombres, FLOW, USE, aridades y usos explícitos de NULL."""
    issues = []

    def error(code, message, node):
        issues.append(Diagnostic(code, message, node.span))

    def unique(items, owner, label):
        seen = set()
        for item in items:
            if item in seen:
                error("E_DUPLICATE", f"{label} duplicado: {item}.", owner)
            seen.add(item)

    def acyclic(graph, node, label):
        try:
            tuple(TopologicalSorter(graph).static_order())
        except CycleError as exc:
            error("E_CYCLE", f"Ciclo en {label}: {' -> '.join(exc.args[1])}.", node)

    unique((p.name for p in program.pipelines), program, "PIPELINE")
    pipelines = {p.name: p for p in program.pipelines}
    uses_graph = {}
    for node in walk(program):
        if isinstance(node, a.TableSchema) and node.fields is not None:
            unique((f.name for f in node.fields), node, "Campo")
        elif isinstance(node, a.Connector):
            unique((arg.name for arg in node.arguments), node, "Argumento")
        elif isinstance(node, (a.Derive, a.FillNull)):
            unique((item.name for item in node.assignments), node, "Asignación")
        elif isinstance(node, a.Aggregate):
            unique((*node.group_by, *(item.alias for item in node.aggregations)), node, "Columna de agregación")
        elif isinstance(node, (a.Select, a.Distinct, a.DropNulls)):
            unique(node.columns, node, "Columna")
        elif isinstance(node, a.Rename):
            unique((item.name for item in node.items), node, "Columna de origen")
            unique((item.alias for item in node.items), node, "Alias")
        elif isinstance(node, a.Sort):
            unique((item.name for item in node.keys), node, "Clave de ordenamiento")
        elif isinstance(node, a.BinaryExpr) and node.operator in {"==", "!=", ">", "<", ">=", "<="}:
            if any(isinstance(side, a.Literal) and side.value is None for side in (node.left, node.right)):
                error("E_NULL_COMPARISON", "Use IS NULL / IS NOT NULL para comparar con NULL.", node)
        elif isinstance(node, a.Call):
            size = len(node.arguments)
            valid = size >= 2 if node.name == "COALESCE" else size == (2 if node.name in {"NULLIF", "SAFE_DIVIDE"} else 1)
            if not valid:
                error("E_ARITY", f"Cantidad de argumentos inválida para {node.name}.", node)
        elif isinstance(node, a.Aggregation):
            if node.function != "COUNT" and node.expression is None:
                error("E_ARITY", f"{node.function} requiere una expresión; solo COUNT() admite cero argumentos.", node)
        elif isinstance(node, a.JoinCondition):
            if {node.left.qualifier, node.right.qualifier} != {"left", "right"}:
                error("E_JOIN_CONDITION", "JOIN debe comparar una columna left con una columna right.", node)

    for pipe in program.pipelines:
        unique((d.name for d in pipe.declarations), pipe, "Identificador")
        declarations = {d.name: d for d in pipe.declarations}
        uses_graph[pipe.name] = set()
        for decl in pipe.declarations:
            if isinstance(decl, a.Use):
                if decl.pipeline not in pipelines:
                    error("E_UNKNOWN_PIPELINE", f"PIPELINE desconocido: {decl.pipeline}.", decl)
                else:
                    uses_graph[pipe.name].add(decl.pipeline)

        def valid_endpoint(endpoint, producer):
            decl = declarations.get(endpoint.name)
            if decl is None:
                error("E_UNKNOWN_NODE", f"Nodo FLOW desconocido: {endpoint.name}.", endpoint)
                return False
            if isinstance(decl, a.Use):
                target = pipelines.get(decl.pipeline)
                if target is None:
                    return False
                port_type = a.Output if producer else a.Input
                valid = endpoint.port in {d.name for d in target.declarations if isinstance(d, port_type)}
            elif producer:
                valid = isinstance(decl, (a.Source, a.Input, a.Step)) and endpoint.port is None
            elif isinstance(decl, a.Step) and isinstance(decl.operation, a.Join):
                valid = endpoint.port in {"left", "right"}
            else:
                valid = isinstance(decl, (a.Step, a.Output, a.Sink)) and endpoint.port is None
            if not valid:
                role = "productor" if producer else "consumidor"
                name = endpoint.name + (f".{endpoint.port}" if endpoint.port else "")
                error("E_PORT", f"Puerto {role} inválido: {name}.", endpoint)
            return valid

        incoming = Counter()
        outgoing = Counter()
        graph = defaultdict(set)
        seen_edges = set()
        for connection in pipe.flow.connections:
            for src, dst in zip(connection.endpoints, connection.endpoints[1:]):
                src_ok = valid_endpoint(src, True)
                dst_ok = valid_endpoint(dst, False)
                if not (src_ok and dst_ok):
                    continue
                src_key, dst_key = (src.name, src.port), (dst.name, dst.port)
                edge = (src_key, dst_key)
                if edge in seen_edges:
                    error("E_DUPLICATE_EDGE", "Conexión FLOW duplicada.", connection)
                seen_edges.add(edge)
                incoming[dst_key] += 1
                outgoing[src_key] += 1
                graph[dst.name].add(src.name)

        for decl in pipe.declarations:
            ports = []
            if isinstance(decl, a.Step) and isinstance(decl.operation, a.Join):
                ports = ["left", "right"]
            elif isinstance(decl, (a.Step, a.Sink, a.Output)):
                ports = [None]
            elif isinstance(decl, a.Use) and decl.pipeline in pipelines:
                ports = [d.name for d in pipelines[decl.pipeline].declarations if isinstance(d, a.Input)]
            for port in ports:
                if incoming[(decl.name, port)] != 1:
                    name = decl.name + (f".{port}" if port else "")
                    error("E_INCOMING", f"{name} requiere exactamente una conexión entrante.", decl)
            if isinstance(decl, (a.Source, a.Input)) and not outgoing[(decl.name, None)]:
                error("E_UNUSED_INPUT", f"Entrada sin uso: {decl.name}.", decl)
        acyclic(graph, pipe.flow, f"FLOW de {pipe.name}")
    acyclic(uses_graph, program, "composición USE")
    return tuple(issues)
