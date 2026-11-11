"""Compilación AST -> IR -> Python con Polars (LazyFrame), sin leer datos al compilar."""
from pathlib import Path

from . import ast as a
from . import ir
from .diagnostics import Diagnostic
from .passes import DEFAULT, optimize
from .validation import validate
from .semantic import infer
from .visitor import walk


class CompileError(ValueError):
    def __init__(self, message: str, *, diagnostic: Diagnostic | None = None):
        super().__init__(message)
        self.diagnostic = diagnostic


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
    def __init__(self, module, filename):
        self.module = module
        self.filename = filename
        self.pipelines = {p.name: p for p in module.pipelines}
        self.functions = {p.name: f"pipeline_{i}" for i, p in enumerate(module.pipelines)}
        self.lines = []

    def emit(self, code):
        self.lines.append("    " + code)

    def connector(self, connector, label, *, sink=False):
        try:
            return _connector(connector, sink=sink)
        except ValueError as exc:
            raise CompileError(f"{label}: E_CONNECTOR: {exc}", diagnostic=Diagnostic(
                "E_CONNECTOR", str(exc), connector.span, phase="backend")) from exc

    def pipeline(self, pipe):
        self.lines.extend(["", f"def {self.functions[pipe.name]}(rt, inputs=None):",
                           f"    # PIPELINE {pipe.name}", "    inputs = inputs or {}"])
        variables = {node.name: f"t_{i}" for i, node in enumerate(pipe.nodes)}

        def producer(ref):
            value = variables[ref.node]
            return value if ref.port is None else f"{value}[{ref.port!r}]"

        outputs = {}
        for node in pipe.nodes:
            var, decl = variables[node.name], node.payload
            label = f"{self.filename}:{node.span.line}:{node.span.column} {pipe.name}.{'+'.join(node.origin)}"
            if len(node.origin) > 1:
                self.emit(f"# {' + '.join(node.origin)} (línea {node.span.line}; fusionados en la IR)")
            else:
                self.emit(f"# {node.name} (línea {node.span.line})")
            if node.kind == "INPUT":
                self.emit(f"{var} = rt.input(inputs, {node.name!r}, {_schema(decl.schema)!r}, {label!r})")
            elif node.kind == "SOURCE":
                driver, options = self.connector(decl.connector, label)
                self.emit(f"{var} = rt.source({driver!r}, {options!r}, {_schema(decl.schema)!r}, {label!r})")
            elif node.kind == "USE":
                target = self.pipelines[decl.pipeline]
                args = [f"{n.name!r}: {producer(node.input(n.name))}" for n in target.nodes if n.kind == "INPUT"]
                self.emit(f"{var} = {self.functions[decl.pipeline]}(rt, {{{', '.join(args)}}})")
            elif node.kind in {"OUTPUT", "SINK"}:
                table = producer(node.input())
                if node.kind == "OUTPUT":
                    self.emit(f"{var} = rt.contract({table}, {_schema(decl.schema)!r}, {label!r})")
                else:
                    driver, options = self.connector(decl.connector, label, sink=True)
                    self.emit(f"{var} = rt.sink({table}, {driver!r}, {options!r}, {label!r})")
                outputs[node.name] = var
            else:
                self.operation(node, var, lambda port=None: producer(node.input(port)), label)
        self.emit("return {" + ", ".join(f"{n!r}: {v}" for n, v in outputs.items()) + "}")

    def operation(self, node, var, producer, label):
        operation = node.payload
        if isinstance(operation, a.Join):
            left = producer("left")
            right = producer("right")
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
        table = producer()
        columns = [n.name for n in walk(operation) if isinstance(n, a.Column)]
        if any(n.qualifier for n in walk(operation) if isinstance(n, a.Column)):
            raise CompileError(f"{label}: solo JOIN admite calificadores left/right.", diagnostic=Diagnostic(
                "E_QUALIFIER", "Solo JOIN admite calificadores left/right.", operation.span,
                phase="backend"))
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


def build_ir(program: a.Program, passes=DEFAULT) -> tuple[ir.Module, ir.Module]:
    """Valida y baja el programa a IR; devuelve la IR antes y después de los pases."""
    issues = validate(program)
    if issues:
        raise CompileError("\n".join(f"{i.code}: {i.message}" for i in issues))
    module = ir.lower(program)
    issues, _ = infer(module)
    if issues:
        raise CompileError("\n".join(f"{i.code}: {i.message}" for i in issues), diagnostic=issues[0])
    try:
        return module, optimize(module, passes)
    except ValueError as exc:
        raise CompileError(str(exc)) from exc


def generate(module: ir.Module, *, filename="<string>", base_dir=".") -> str:
    """IR -> Python ejecutable. Los datos se abren únicamente al ejecutarlo."""
    generator = PythonGenerator(module, str(filename))
    for pipe in module.pipelines:
        generator.pipeline(pipe)
    defaults = list(module.defaults)
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


def compile_program(program: a.Program, *, filename="<string>", base_dir=".", passes=DEFAULT) -> str:
    """AST -> IR optimizada -> Python. `passes=()` equivale a -O0."""
    _, optimized = build_ir(program, passes)
    return generate(optimized, filename=filename, base_dir=base_dir)
