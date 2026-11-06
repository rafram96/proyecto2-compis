"""Compilación AST -> Python con Polars (LazyFrame), sin leer datos al compilar."""
from graphlib import TopologicalSorter
from pathlib import Path

from . import ast as a
from .validation import validate
from .visitor import walk


class CompileError(ValueError):
    pass


def col(name: str) -> str:
    return f"pl.col({name!r})"


def literal(value) -> str:
    if value is None or isinstance(value, (bool, int, str)):
        return f"pl.lit({value!r})"
    # Decimal(...) conserva la precisión del literal del programa fuente.
    return f"pl.lit(Decimal({str(value)!r}))"


BINARY = {"AND": "&", "OR": "|", "==": "==", "!=": "!=", ">": ">", "<": "<",
          ">=": ">=", "<=": "<=", "+": "+", "-": "-", "*": "*", "/": "/"}
AGGREGATES = {"AVG": "mean", "MIN": "min", "MAX": "max"}


def expression(node: a.Expr) -> str:
    if isinstance(node, a.Literal):
        return literal(node.value)
    if isinstance(node, a.Column):
        return col(node.name)
    if isinstance(node, a.UnaryExpr):
        operand = expression(node.operand)
        if node.operator == "IS NULL":
            return f"{operand}.is_null()"
        if node.operator == "IS NOT NULL":
            return f"{operand}.is_not_null()"
        return f"({'~' if node.operator == 'NOT' else '-'}{operand})"
    if isinstance(node, a.BinaryExpr):
        return f"({expression(node.left)} {BINARY[node.operator]} {expression(node.right)})"
    if isinstance(node, a.Call):
        args = [expression(arg) for arg in node.arguments]
        if node.name == "COALESCE":
            return f"pl.coalesce({', '.join(args)})"
        if node.name == "NULLIF":
            return f"pl.when({args[0]} == {args[1]}).then(None).otherwise({args[0]})"
        if node.name == "SAFE_DIVIDE":
            return f"pl.when({args[1]} != 0).then({args[0]} / {args[1]})"
        if node.name == "LOWER":
            return f"{args[0]}.str.to_lowercase()"
        if node.name == "UPPER":
            return f"{args[0]}.str.to_uppercase()"
        if node.name == "TRIM":
            # TRIM de SQL quita solo espacios, no otros caracteres en blanco.
            return f"{args[0]}.str.strip_chars(' ')"
    raise CompileError(f"Expresión no soportada: {type(node).__name__}.")


def aggregation(node: a.Aggregation) -> str:
    """Agregaciones con semántica SQL: SUM de un grupo sin valores es NULL, no 0."""
    if node.function == "COUNT":
        value = "pl.len()" if node.expression is None else f"{expression(node.expression)}.count()"
        return f"{value}.cast(pl.Int64).alias({node.alias!r})"
    expr = expression(node.expression)
    if node.function == "SUM":
        value = f"pl.when({expr}.count() > 0).then({expr}.sum())"
    else:
        value = f"{expr}.{AGGREGATES[node.function]}()"
    return f"{value}.alias({node.alias!r})"


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
            valid = isinstance(value, str) and (bool(value) or key == "nullstr") and "\0" not in value
        if not valid:
            raise CompileError(f"{name}.{key}: tipo o valor de opción inválido.")
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
                self.operation(decl.operation, var, producer, incoming, name, label)
        self.emit("return {" + ", ".join(f"{n!r}: {v}" for n, v in outputs.items()) + "}")

    def operation(self, operation, var, producer, incoming, name, label):
        if isinstance(operation, a.Join):
            left = producer(incoming[(name, "left")])
            right = producer(incoming[(name, "right")])
            for side, table in [("left", left), ("right", right)]:
                columns = [n.name for n in walk(operation) if isinstance(n, a.Column) and n.qualifier == side]
                self.emit(f"rt.require_columns({table}, {columns!r}, {label!r})")
            self.emit(f"rt.disjoint({left}, {right}, {label!r})")
            pairs = [(c.left, c.right) if c.left.qualifier == "left" else (c.right, c.left)
                     for c in operation.conditions]
            left_on = [l.name for l, _ in pairs]
            right_on = [r.name for _, r in pairs]
            # coalesce=False conserva las claves de ambos lados, como SELECT left.*, right.*.
            self.emit(f"{var} = rt.step({left}.join({right}, left_on={left_on!r}, right_on={right_on!r}, "
                      f"how={operation.kind.lower()!r}, coalesce=False), {label!r})")
            return
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
        if isinstance(operation, a.Filter):
            plan = f"{table}.filter({expression(operation.predicate)})"
        elif isinstance(operation, a.Select):
            plan = f"{table}.select({list(operation.columns)!r})"
        elif isinstance(operation, a.Distinct):
            plan = f"{table}.select({list(operation.columns)!r}).unique(maintain_order=True)"
        elif isinstance(operation, a.Derive):
            self.emit(f"rt.new_columns({table}, {[i.name for i in operation.assignments]!r}, {label!r})")
            items = ", ".join(f"{expression(i.expression)}.alias({i.name!r})" for i in operation.assignments)
            plan = f"{table}.with_columns({items})"
        elif isinstance(operation, a.FillNull):
            items = ", ".join(f"pl.coalesce({col(i.name)}, {expression(i.expression)}).alias({i.name!r})"
                              for i in operation.assignments)
            plan = f"{table}.with_columns({items})"
        elif isinstance(operation, a.DropNulls):
            plan = f"{table}.drop_nulls(subset={list(operation.columns)!r})"
        elif isinstance(operation, a.Aggregate):
            items = ", ".join(aggregation(i) for i in operation.aggregations)
            if operation.group_by:
                plan = f"{table}.group_by({list(operation.group_by)!r}, maintain_order=True).agg({items})"
            else:
                plan = f"{table}.select({items})"
        elif isinstance(operation, a.Sort):
            keys = [k.name for k in operation.keys]
            descending = [k.direction == "DESC" for k in operation.keys]
            # NULLS LAST en ambas direcciones, como el orden por defecto de SQL en DuckDB.
            plan = (f"{table}.sort({keys!r}, descending={descending!r}, "
                    f"nulls_last=True, maintain_order=True)")
        elif isinstance(operation, a.Rename):
            mapping = {item.name: item.alias for item in operation.items}
            self.emit(f"rt.check_rename({table}, {mapping!r}, {label!r})")
            plan = f"{table}.rename({mapping!r})"
        else:
            raise CompileError(f"Operación no soportada: {type(operation).__name__}.")
        self.emit(f"{var} = rt.step({plan}, {label!r})")


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
    header = ['# Código generado por etl-dsl: Python + Polars (LazyFrame).',
              'import sys',
              '# Evitar que archivos generados como polars.py oculten las dependencias.',
              'if __name__ == "__main__" and not sys.flags.safe_path:',
              '    del sys.path[0]',
              'from decimal import Decimal',
              '',
              'import polars as pl',
              '',
              'from etl_dsl.runtime import generated_main', '']
    footer = ["", f"PIPELINES = {{{functions}}}", f"DEFAULT_PIPELINES = {defaults!r}",
              "", 'if __name__ == "__main__":',
              f"    raise SystemExit(generated_main(PIPELINES, DEFAULT_PIPELINES, {str(Path(base_dir).resolve())!r}))", ""]
    return "\n".join(header + generator.lines + footer)
