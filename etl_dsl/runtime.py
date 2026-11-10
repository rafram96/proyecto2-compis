"""Ejecución del Python generado: Polars realiza todas las transformaciones.

Cada paso es un LazyFrame inmutable; nada se calcula hasta un SINK o un
contrato que necesite los datos, de modo que Polars optimiza el plan completo.
SQLite se lee con sqlite3; las bases DuckDB se leen y escriben con el paquete
duckdb, usado solo como conector (sin pyarrow).
"""
from contextlib import closing
from pathlib import Path
import argparse
import re
import sqlite3
import sys

import polars as pl

from .sql import identifier as q
from .type import accepts_polars


class ExecutionError(ValueError):
    pass


def _affinity(declared):
    """Tipo Polars para una columna SQLite según su tipo declarado."""
    declared = declared.upper()
    if "BOOL" in declared:
        return pl.Boolean
    if "TIMESTAMP" in declared or "DATETIME" in declared:
        return pl.Datetime
    if declared == "DATE":
        return pl.Date
    if "INT" in declared:
        return pl.Int64
    if any(part in declared for part in ("CHAR", "CLOB", "TEXT")):
        return pl.String
    if "BLOB" in declared:
        return pl.Binary
    if any(part in declared for part in ("REAL", "FLOA", "DOUB", "NUM", "DEC")):
        return pl.Float64
    return pl.String


_FROM_DUCKDB = {"BOOLEAN": pl.Boolean, "TINYINT": pl.Int8, "SMALLINT": pl.Int16, "INTEGER": pl.Int32,
                "BIGINT": pl.Int64, "UTINYINT": pl.UInt8, "USMALLINT": pl.UInt16, "UINTEGER": pl.UInt32,
                "UBIGINT": pl.UInt64, "FLOAT": pl.Float32, "DOUBLE": pl.Float64, "VARCHAR": pl.String,
                "DATE": pl.Date, "TIMESTAMP": pl.Datetime("us"), "BLOB": pl.Binary}


def _from_duckdb(declared):
    match = re.fullmatch(r"DECIMAL\((\d+),(\d+)\)", declared)
    if match:
        return pl.Decimal(int(match[1]), int(match[2]))
    return _FROM_DUCKDB.get(declared)  # None: Polars infiere el tipo.


def _to_duckdb(dtype):
    if isinstance(dtype, pl.Decimal):
        return f"DECIMAL({dtype.precision},{dtype.scale})"
    if isinstance(dtype, pl.Datetime):
        return "TIMESTAMP"
    for name, candidate in _FROM_DUCKDB.items():
        if dtype == candidate:
            return name
    return "VARCHAR"


class PolarsRuntime:
    def __init__(self, base_dir=".", root=None):
        """`root`, si se indica, es la única carpeta que SOURCE y SINK pueden usar."""
        self.base_dir = Path(base_dir).resolve()
        self.root = None if root is None else Path(root).resolve()
        self.written = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return None

    @staticmethod
    def _unique(columns, label):
        names = list(columns)
        if len({name.casefold() for name in names}) != len(names):
            raise ExecutionError(f"{label}: E_AMBIGUOUS_COLUMNS: nombres de salida ambiguos: {names}.")

    @staticmethod
    def frame(table, label="frame"):
        if isinstance(table, pl.DataFrame):
            return table.lazy()
        if not isinstance(table, pl.LazyFrame):
            raise ExecutionError(f"{label}: la entrada debe ser un DataFrame o LazyFrame de Polars.")
        return table

    def schema(self, table, label="schema"):
        try:
            return self.frame(table, label).collect_schema()
        except pl.exceptions.PolarsError as exc:
            raise ExecutionError(f"{label}: E_POLARS: {exc}") from exc

    def columns(self, table, label="columns"):
        return tuple(self.schema(table, label).names())

    def collect(self, table, label="collect"):
        try:
            return self.frame(table, label).collect()
        except pl.exceptions.PolarsError as exc:
            raise ExecutionError(f"{label}: E_POLARS: {exc}") from exc

    def step(self, table, label="step"):
        """Resuelve el esquema del plan sin ejecutarlo; detecta tipos y nombres inválidos."""
        self._unique(self.columns(table, label), label)
        return table

    def require_columns(self, table, columns, label):
        available = self.columns(table, label)
        missing = set(columns) - set(available)
        if missing:
            raise ExecutionError(f"{label}: E_COLUMN: columnas inexistentes: {sorted(missing)}; "
                                 f"disponibles: {list(available)}.")

    def new_columns(self, table, columns, label):
        self._unique([*self.columns(table, label), *columns], label)

    def disjoint(self, left, right, label):
        self._unique([*self.columns(left, label), *self.columns(right, label)], label)

    def check_rename(self, table, mapping, label):
        self.require_columns(table, mapping, label)
        self._unique([mapping.get(name, name) for name in self.columns(table, label)], label)

    def contract(self, table, schema, label):
        table = self.frame(table, label)
        if schema is None:
            return self.step(table, label)
        names = [name for name, _, _ in schema]
        self._unique(names, label)
        actual = self.schema(table, label)
        if tuple(names) != tuple(actual.names()):
            raise ExecutionError(f"{label}: E_SCHEMA: se esperaba {names}, se obtuvo {actual.names()}.")
        for name, expected, _ in schema:
            if not accepts_polars(expected, actual[name]):
                raise ExecutionError(f"{label}: E_TYPE: {name}: se esperaba {expected}, se obtuvo {actual[name]}.")
        required = [name for name, _, nullable in schema if not nullable]
        if required:
            counts = self.collect(table.select(pl.col(required).null_count()), label).row(0)
            invalid = [name for name, count in zip(required, counts) if count]
            if invalid:
                raise ExecutionError(f"{label}: E_NULL: columnas no anulables contienen NULL: {invalid}.")
        return table

    def input(self, inputs, name, schema, label):
        if name not in inputs:
            raise ExecutionError(f"{label}: falta enlazar INPUT {name}.")
        return self.contract(inputs[name], schema, label)

    def _path(self, value, label):
        path = Path(value)
        path = path.resolve() if path.is_absolute() else (self.base_dir / path).resolve()
        if self.root is not None and not path.is_relative_to(self.root):
            raise ExecutionError(f"{label}: E_PATH: {value} está fuera de la carpeta de trabajo.")
        return path

    def _sqlite(self, path, table, label):
        try:
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source:
                fields = source.execute(f"PRAGMA table_info({q(table)})").fetchall()
                if not fields:
                    raise ExecutionError(f"{label}: E_SQLITE: tabla inexistente o sin columnas: {table}.")
                schema = {field[1]: _affinity(field[2]) for field in fields}
                self._unique(schema, label)
                rows = source.execute(f"SELECT * FROM {q(table)}").fetchall()
        except sqlite3.Error as exc:
            raise ExecutionError(f"{label}: E_SQLITE: {exc}") from exc
        return pl.DataFrame(rows, schema=schema, orient="row", strict=False).lazy()

    def _duckdb(self, path, options, label):
        import duckdb

        target = f"{q(options.get('schema', 'main'))}.{q(options['table'])}"
        try:
            with duckdb.connect(str(path), read_only=True) as con:
                fields = con.execute(f"DESCRIBE SELECT * FROM {target}").fetchall()
                rows = con.execute(f"SELECT * FROM {target}").fetchall()
        except duckdb.Error as exc:
            raise ExecutionError(f"{label}: E_DUCKDB: {exc}") from exc
        schema = {name: _from_duckdb(typ) for name, typ, *_ in fields}
        return pl.DataFrame(rows, schema=schema, orient="row", strict=False).lazy()

    def source(self, driver, options, schema, label):
        path = self._path(options["file"], label)
        if not path.is_file():
            raise ExecutionError(f"{label}: E_SOURCE: no existe el archivo {path}.")
        try:
            if driver == "SQLITE":
                table = self._sqlite(path, options["table"], label)
            elif driver == "DUCKDB":
                table = self._duckdb(path, options, label)
            elif driver == "CSV":
                nullstr = options.get("nullstr", "")
                # Con nullstr vacío, Polars distingue "" (texto vacío) de un campo ausente (NULL).
                table = pl.scan_csv(path, has_header=options.get("header", True),
                                    separator=options.get("delimiter", ","),
                                    null_values=[nullstr] if nullstr else None,
                                    infer_schema_length=10_000)
            elif driver == "PARQUET":
                table = pl.scan_parquet(path)
            else:
                raise ExecutionError(f"{label}: conector SOURCE no soportado: {driver}.")
        except pl.exceptions.PolarsError as exc:
            raise ExecutionError(f"{label}: E_SOURCE: {exc}") from exc
        return self.contract(table, schema, label)

    def _duckdb_sink(self, frame, path, options, label):
        import duckdb

        schema = options.get("schema", "main")
        target = f"{q(schema)}.{q(options['table'])}"
        mode = options.get("mode", "error")
        columns = ", ".join(q(name) for name in frame.columns)
        try:
            with duckdb.connect(str(path)) as con:
                con.execute(f"CREATE SCHEMA IF NOT EXISTS {q(schema)}")
                if mode != "append":
                    definitions = ", ".join(f"{q(name)} {_to_duckdb(dtype)}"
                                            for name, dtype in frame.schema.items())
                    create = "CREATE OR REPLACE TABLE" if mode == "replace" else "CREATE TABLE"
                    con.execute(f"{create} {target} ({definitions})")
                # Insertar por nombre impide escribir datos en una columna distinta por posición.
                insert = f"INSERT INTO {target} ({columns}) VALUES ({', '.join('?' for _ in frame.columns)})"
                if frame.height:
                    con.executemany(insert, frame.rows())
        except duckdb.Error as exc:
            raise ExecutionError(f"{label}: E_DUCKDB: {exc}") from exc

    def sink(self, table, driver, options, label):
        frame = self.collect(table, label)
        path = self._path(options["file"], label)
        path.parent.mkdir(parents=True, exist_ok=True)
        if driver == "DUCKDB":
            self._duckdb_sink(frame, path, options, label)
        elif driver == "CSV":
            frame.write_csv(path, include_header=options.get("header", True),
                            separator=options.get("delimiter", ","),
                            null_value=options.get("nullstr", ""))
        elif driver == "PARQUET":
            frame.write_parquet(path)
        else:
            raise ExecutionError(f"{label}: conector SINK no soportado: {driver}.")
        self.written.append(str(path))
        return frame.lazy()


def run_pipelines(rt, pipelines, defaults, names=None, inputs=None):
    selected = defaults if names is None else names
    if not selected:
        raise ExecutionError("No hay pipelines raíz ejecutables; seleccione uno y enlace sus INPUT.")
    unknown = set(selected) - pipelines.keys()
    if unknown:
        raise ExecutionError(f"PIPELINE desconocido: {sorted(unknown)}.")
    return {name: pipelines[name](rt, (inputs or {}).get(name)) for name in selected}


def generated_main(pipelines, defaults, base_dir, argv=None):
    parser = argparse.ArgumentParser(description="Pipeline ETL generado para Polars")
    parser.add_argument("--pipeline", action="append", help="Nombre a ejecutar; repetible")
    parser.add_argument("--base-dir", default=base_dir, type=Path, help="Base de rutas de SOURCE/SINK")
    args = parser.parse_args(argv)
    try:
        with PolarsRuntime(args.base_dir) as rt:
            results = run_pipelines(rt, pipelines, defaults, args.pipeline)
            for name in results:
                print(f"POLARS: PIPELINE {name} ejecutado.")
            for path in rt.written:
                print(f"SINK: {path}")
        return 0
    except (ExecutionError, pl.exceptions.PolarsError, OSError) as exc:
        print(exc, file=sys.stderr)
        return 1
