"""Compilación AST -> Python con SQL DuckDB, sin leer datos al compilar."""
from graphlib import TopologicalSorter
from pathlib import Path

from . import ast as a
from .sql import identifier as q, literal
from .validation import validate
from .visitor import walk


class CompileError(ValueError):
    pass


def expression(node: a.Expr) -> str:
    if isinstance(node, a.Literal):
        return literal(node.value)
    if isinstance(node, a.Column):
        return (q(node.qualifier) + "." if node.qualifier else "") + q(node.name)
    if isinstance(node, a.UnaryExpr):
        operand = expression(node.operand)
        if node.operator in {"IS NULL", "IS NOT NULL"}:
            return f"({operand} {node.operator})"
        return f"({node.operator} {operand})"
    if isinstance(node, a.BinaryExpr):
        op = "=" if node.operator == "==" else node.operator
        return f"({expression(node.left)} {op} {expression(node.right)})"
    if isinstance(node, a.Call):
        args = [expression(arg) for arg in node.arguments]
        if node.name == "SAFE_DIVIDE":
            return f"({args[0]} / NULLIF({args[1]}, 0))"
        return f"{node.name}({', '.join(args)})"
    raise CompileError(f"Expresión no soportada: {type(node).__name__}.")


def _schema(schema):
    if schema is None or schema.fields is None:
        return None
    return [(f.name, f.type.value, f.nullable) for f in schema.fields]


def _connector(connector, *, sink=False):
    options = {arg.name: arg.value.value for arg in connector.arguments}
    allowed = {"CSV": {"file", "header", "delimiter", "nullstr"},
               "PARQUET": {"file"}, "DUCKDB": {"file", "table", "schema", "mode"},
               "SQLITE": {"file", "table"}}
    name = connector.name
    if name not in allowed or (sink and name == "SQLITE"):
        raise CompileError(f"Conector {'SINK' if sink else 'SOURCE'} no soportado: {name}.")
    keys = allowed[name] - ({"mode"} if not sink else set())
    unknown = options.keys() - keys
    required = {"file", "table"} if name in {"DUCKDB", "SQLITE"} else {"file"}
    if unknown or required - options.keys():
        raise CompileError(f"{name}: opciones desconocidas {sorted(unknown)}; "
                           f"faltan {sorted(required - options.keys())}.")
    for key, value in options.items():
        if key == "header":
            valid = isinstance(value, bool)
        else:
            valid = isinstance(value, str) and (bool(value) or key == "nullstr")
        if not valid:
            raise CompileError(f"{name}.{key}: tipo o valor de opción inválido.")
        if isinstance(value, str):
            literal(value)  # Rechazar NUL antes de generar código.
    if "delimiter" in options and len(options["delimiter"]) != 1:
        raise CompileError("CSV.delimiter debe contener un carácter.")
    if options.get("mode", "error") not in {"error", "replace", "append"}:
        raise CompileError("DUCKDB.mode debe ser error, replace o append.")
    return name, options


class PythonGenerator:
    def __init__(self, program, filename):
        self.program = program
        self.filename = filename
        self.pipelines = {p.name: p for p in program.pipelines}
        self.functions = {p.name: f"pipeline_{i}" for i, p in enumerate(program.pipelines)}
        self.lines = []

    def emit(self, code):
        self.lines.append("    " + code)

    def connector(self, connector, label, *, sink=False):
        try:
            return _connector(connector, sink=sink)
        except ValueError as exc:
            raise CompileError(f"{label}: E_CONNECTOR: {exc}") from exc

    def pipeline(self, pipe):
        self.lines.extend(["", f"def {self.functions[pipe.name]}(rt, inputs=None):",
                           f"    # PIPELINE {pipe.name}", "    inputs = inputs or {}"])
        declarations = {d.name: d for d in pipe.declarations}
        variables = {d.name: f"t_{i}" for i, d in enumerate(pipe.declarations)}
        incoming = {}
        graph = {name: set() for name in declarations}
        for chain in pipe.flow.connections:
            for src, dst in zip(chain.endpoints, chain.endpoints[1:]):
                incoming[(dst.name, dst.port)] = src
                graph[dst.name].add(src.name)

        def producer(endpoint):
            value = variables[endpoint.name]
            return value if endpoint.port is None else f"{value}[{endpoint.port!r}]"

        outputs = {}
        for name in TopologicalSorter({n: sorted(v) for n, v in graph.items()}).static_order():
            decl, var = declarations[name], variables[name]
            label = f"{self.filename}:{decl.span.line}:{decl.span.column} {pipe.name}.{name}"
            self.emit(f"# {name} (línea {decl.span.line})")
            if isinstance(decl, a.Input):
                self.emit(f"{var} = rt.input(inputs, {name!r}, {_schema(decl.schema)!r}, {label!r})")
            elif isinstance(decl, a.Source):
                driver, options = self.connector(decl.connector, label)
                self.emit(f"{var} = rt.source({driver!r}, {options!r}, {_schema(decl.schema)!r}, {label!r})")
            elif isinstance(decl, a.Use):
                target = self.pipelines[decl.pipeline]
                args = [f"{d.name!r}: {producer(incoming[(name, d.name)])}"
                        for d in target.declarations if isinstance(d, a.Input)]
                self.emit(f"{var} = {self.functions[decl.pipeline]}(rt, {{{', '.join(args)}}})")
            elif isinstance(decl, (a.Output, a.Sink)):
                table = producer(incoming[(name, None)])
                if isinstance(decl, a.Output):
                    self.emit(f"{var} = rt.contract({table}, {_schema(decl.schema)!r}, {label!r})")
                else:
                    driver, options = self.connector(decl.connector, label, sink=True)
                    self.emit(f"{var} = rt.sink({table}, {driver!r}, {options!r}, {label!r})")
                outputs[name] = var
            else:
                operation = decl.operation
                if isinstance(operation, a.Join):
                    left = producer(incoming[(name, "left")])
                    right = producer(incoming[(name, "right")])
                    for side, table in [("left", left), ("right", right)]:
                        columns = [n.name for n in walk(operation) if isinstance(n, a.Column) and n.qualifier == side]
                        self.emit(f"rt.require_columns({table}, {columns!r}, {label!r})")
                    self.emit(f"rt.disjoint({left}, {right}, {label!r})")
                    conditions = " AND ".join(f"{expression(c.left)} = {expression(c.right)}" for c in operation.conditions)
                    prefix = 'SELECT "left".*, "right".* FROM '
                    tail = f' AS "right" ON {conditions}'
                    self.emit(f"{var} = rt.query({prefix!r} + {left}.sql + "
                              f"{' AS ' + q('left') + ' ' + operation.kind + ' JOIN '!r} + {right}.sql + {tail!r}, {label!r})")
                    continue
                table = producer(incoming[(name, None)])
                columns = [n.name for n in walk(operation) if isinstance(n, a.Column)]
                if any(n.qualifier for n in walk(operation) if isinstance(n, a.Column)):
                    raise CompileError(f"{label}: solo JOIN admite calificadores left/right.")
                if isinstance(operation, (a.Select, a.Distinct, a.DropNulls)):
                    columns.extend(operation.columns)
                elif isinstance(operation, a.Aggregate):
                    columns.extend(operation.group_by)
                elif isinstance(operation, a.Sort):
                    columns.extend(k.name for k in operation.keys)
                elif isinstance(operation, a.FillNull):
                    columns.extend(item.name for item in operation.assignments)
                self.emit(f"rt.require_columns({table}, {columns!r}, {label!r})")
                prefix, suffix = "SELECT * FROM ", ""
                if isinstance(operation, a.Filter):
                    suffix = " WHERE " + expression(operation.predicate)
                elif isinstance(operation, (a.Select, a.Distinct)):
                    prefix = "SELECT " + ("DISTINCT " if isinstance(operation, a.Distinct) else "")
                    prefix += ", ".join(q(c) for c in operation.columns) + " FROM "
                elif isinstance(operation, a.Derive):
                    self.emit(f"rt.new_columns({table}, {[i.name for i in operation.assignments]!r}, {label!r})")
                    prefix = "SELECT *, " + ", ".join(f"{expression(i.expression)} AS {q(i.name)}" for i in operation.assignments) + " FROM "
                elif isinstance(operation, a.FillNull):
                    prefix = "SELECT * REPLACE (" + ", ".join(
                        f"COALESCE({q(i.name)}, {expression(i.expression)}) AS {q(i.name)}"
                        for i in operation.assignments) + ") FROM "
                elif isinstance(operation, a.DropNulls):
                    suffix = " WHERE " + " AND ".join(f"{q(c)} IS NOT NULL" for c in operation.columns)
                elif isinstance(operation, a.Aggregate):
                    items = [q(c) for c in operation.group_by]
                    items.extend(f"{i.function}({expression(i.expression) if i.expression is not None else '*'}) AS {q(i.alias)}"
                                 for i in operation.aggregations)
                    prefix = "SELECT " + ", ".join(items) + " FROM "
                    if operation.group_by:
                        suffix = " GROUP BY " + ", ".join(q(c) for c in operation.group_by)
                elif isinstance(operation, a.Sort):
                    suffix = " ORDER BY " + ", ".join(f"{q(k.name)} {k.direction}" for k in operation.keys)
                elif isinstance(operation, a.Rename):
                    mapping = {item.name: item.alias for item in operation.items}
                    self.emit(f"{var} = rt.rename({table}, {mapping!r}, {label!r})")
                    continue
                else:
                    raise CompileError(f"Operación no soportada: {type(operation).__name__}.")
                self.emit(f"{var} = rt.query({prefix!r} + {table}.sql + {suffix!r}, {label!r})")
        self.emit("return {" + ", ".join(f"{n!r}: {v}" for n, v in outputs.items()) + "}")


def compile_program(program: a.Program, *, filename="<string>", base_dir=".") -> str:
    """Genera Python ejecutable. Los datos se abren únicamente al ejecutarlo."""
    issues = validate(program)
    if issues:
        raise CompileError("\n".join(f"{i.code}: {i.message}" for i in issues))
    generator = PythonGenerator(program, str(filename))
    for pipe in program.pipelines:
        generator.pipeline(pipe)
    used = {d.pipeline for p in program.pipelines for d in p.declarations if isinstance(d, a.Use)}
    defaults = [p.name for p in program.pipelines if p.name not in used and
                not any(isinstance(d, a.Input) for d in p.declarations)]
    functions = ", ".join(f"{name!r}: {fn}" for name, fn in generator.functions.items())
    header = ['# Código generado por etl-dsl: Python + SQL DuckDB.',
              'import sys',
              '# Evitar que archivos generados como duckdb.py oculten las dependencias.',
              'if __name__ == "__main__" and not sys.flags.safe_path:',
              '    del sys.path[0]',
              'from etl_dsl.runtime import generated_main', '']
    footer = ["", f"PIPELINES = {{{functions}}}", f"DEFAULT_PIPELINES = {defaults!r}",
              "", 'if __name__ == "__main__":',
              f"    raise SystemExit(generated_main(PIPELINES, DEFAULT_PIPELINES, {str(Path(base_dir).resolve())!r}))", ""]
    return "\n".join(header + generator.lines + footer)
