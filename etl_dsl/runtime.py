"""Ejecución del Python generado: DuckDB realiza todas las transformaciones.

Los pasos se materializan en tablas temporales inmutables para dar a cada rama
una entrada estable. SQLite se importa con sqlite3, sin descargar extensiones.
"""
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
import argparse
import sqlite3
import sys
from uuid import uuid4

import duckdb

from .sql import identifier as q, literal
from .type import accepts_duckdb


class ExecutionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Table:
    name: str
    fields: tuple[tuple[str, str], ...]
    owner: str

    @property
    def sql(self):
        return q(self.name)

    @property
    def columns(self):
        return tuple(name for name, _ in self.fields)


class DuckDBRuntime:
    def __init__(self, base_dir=".", *, connection=None):
        self.base_dir = Path(base_dir).resolve()
        self.connection = connection if connection is not None else duckdb.connect(":memory:")
        self._owns_connection = connection is None
        self._prefix = "etl_" + uuid4().hex
        self._counter = 0
        self._attached = {}
        self.written = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        if self._owns_connection:
            self.connection.close()

    def _name(self):
        self._counter += 1
        return f"{self._prefix}_{self._counter}"

    def _execute(self, sql, label, parameters=None):
        try:
            return self.connection.execute(sql, parameters)
        except duckdb.Error as exc:
            raise ExecutionError(f"{label}: E_DUCKDB: {exc}") from exc

    @staticmethod
    def _unique(columns, label):
        names = list(columns)
        if len({name.casefold() for name in names}) != len(names):
            raise ExecutionError(f"{label}: E_AMBIGUOUS_COLUMNS: nombres de salida ambiguos: {names}.")

    def query(self, sql: str, label="query") -> Table:
        fields = tuple((row[0], row[1]) for row in self._execute("DESCRIBE " + sql, label).fetchall())
        self._unique((name for name, _ in fields), label)
        name = self._name()
        self._execute(f"CREATE TEMP TABLE {q(name)} AS {sql}", label)
        return Table(name, fields, self._prefix)

    def require_columns(self, table, columns, label):
        if not isinstance(table, Table) or table.owner != self._prefix:
            raise ExecutionError(f"{label}: la entrada debe pertenecer a este runtime DuckDB.")
        missing = set(columns) - set(table.columns)
        if missing:
            raise ExecutionError(f"{label}: E_COLUMN: columnas inexistentes: {sorted(missing)}; "
                                 f"disponibles: {list(table.columns)}.")

    def new_columns(self, table, columns, label):
        self._unique([*table.columns, *columns], label)

    def disjoint(self, left, right, label):
        self._unique([*left.columns, *right.columns], label)

    def rename(self, table, mapping, label):
        self.require_columns(table, mapping, label)
        names = [mapping.get(name, name) for name in table.columns]
        self._unique(names, label)
        columns = ", ".join(f"{q(name)} AS {q(mapping.get(name, name))}" for name in table.columns)
        return self.query(f"SELECT {columns} FROM {table.sql}", label)

    def contract(self, table, schema, label):
        self.require_columns(table, (), label)
        if schema is None:
            return table
        names = [name for name, _, _ in schema]
        self._unique(names, label)
        if tuple(names) != table.columns:
            raise ExecutionError(f"{label}: E_SCHEMA: se esperaba {names}, se obtuvo {list(table.columns)}.")
        for (_, expected, _), (name, actual) in zip(schema, table.fields):
            if not accepts_duckdb(expected, actual):
                raise ExecutionError(f"{label}: E_TYPE: {name}: se esperaba {expected}, se obtuvo {actual}.")
        required = [name for name, _, nullable in schema if not nullable]
        if required:
            checks = ", ".join(f"COUNT(*) FILTER (WHERE {q(name)} IS NULL)" for name in required)
            counts = self._execute(f"SELECT {checks} FROM {table.sql}", label).fetchone()
            invalid = [name for name, count in zip(required, counts) if count]
            if invalid:
                raise ExecutionError(f"{label}: E_NULL: columnas no anulables contienen NULL: {invalid}.")
        return table

    def input(self, inputs, name, schema, label):
        if name not in inputs:
            raise ExecutionError(f"{label}: falta enlazar INPUT {name}.")
        return self.contract(inputs[name], schema, label)

    def _path(self, value):
        path = Path(value)
        return path.resolve() if path.is_absolute() else (self.base_dir / path).resolve()

    def _attach(self, path, *, readonly, label):
        key = str(path)
        if key in self._attached:
            alias, is_readonly = self._attached[key]
            if is_readonly and not readonly:
                raise ExecutionError(f"{label}: no se puede escribir una base adjunta como SOURCE de solo lectura.")
            return alias
        alias = self._name()
        self._execute(f"ATTACH {literal(str(path))} AS {q(alias)} "
                      f"({'READ_ONLY' if readonly else 'READ_WRITE'}, TYPE DUCKDB)", label)
        self._attached[key] = (alias, readonly)
        return alias

    def _sqlite(self, path, table, label):
        try:
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as source:
                fields = source.execute(f"PRAGMA table_info({q(table)})").fetchall()
                if not fields:
                    raise ExecutionError(f"{label}: E_SQLITE: tabla inexistente o sin columnas: {table}.")
                names = [field[1] for field in fields]
                self._unique(names, label)

                def affinity(declared):
                    declared = declared.upper()
                    if "BOOL" in declared:
                        return "BOOLEAN"
                    if "TIMESTAMP" in declared or "DATETIME" in declared:
                        return "TIMESTAMP"
                    if declared == "DATE":
                        return "DATE"
                    if "INT" in declared:
                        return "BIGINT"
                    if any(part in declared for part in ("CHAR", "CLOB", "TEXT")):
                        return "VARCHAR"
                    if "BLOB" in declared:
                        return "BLOB"
                    if any(part in declared for part in ("REAL", "FLOA", "DOUB", "NUM", "DEC")):
                        return "DOUBLE"
                    return "VARCHAR"

                types = [affinity(field[2]) for field in fields]
                name = self._name()
                definitions = ", ".join(f"{q(col)} {typ}" for col, typ in zip(names, types))
                self._execute(f"CREATE TEMP TABLE {q(name)} ({definitions})", label)
                cursor = source.execute(f"SELECT * FROM {q(table)}")
                insert = f"INSERT INTO {q(name)} VALUES ({', '.join('?' for _ in names)})"
                while batch := cursor.fetchmany(1000):
                    self.connection.executemany(insert, batch)
                return Table(name, tuple(zip(names, types)), self._prefix)
        except (sqlite3.Error, duckdb.Error) as exc:
            raise ExecutionError(f"{label}: E_SQLITE: {exc}") from exc

    def source(self, driver, options, schema, label):
        path = self._path(options["file"])
        if not path.is_file():
            raise ExecutionError(f"{label}: E_SOURCE: no existe el archivo {path}.")
        if driver == "SQLITE":
            table = self._sqlite(path, options["table"], label)
        elif driver == "DUCKDB":
            alias = self._attach(path, readonly=True, label=label)
            table = self.query(f"SELECT * FROM {q(alias)}.{q(options.get('schema', 'main'))}.{q(options['table'])}", label)
        elif driver == "CSV":
            args = {"header": options.get("header", True), "delim": options.get("delimiter", ","),
                    "nullstr": options.get("nullstr", ""), "allow_quoted_nulls": False}
            sql_options = ", ".join(f"{key}={literal(value)}" for key, value in args.items())
            table = self.query(f"SELECT * FROM read_csv({literal(str(path))}, {sql_options})", label)
        elif driver == "PARQUET":
            table = self.query(f"SELECT * FROM read_parquet({literal(str(path))})", label)
        else:
            raise ExecutionError(f"{label}: conector SOURCE no soportado: {driver}.")
        return self.contract(table, schema, label)

    def sink(self, table, driver, options, label):
        path = self._path(options["file"])
        path.parent.mkdir(parents=True, exist_ok=True)
        if driver == "DUCKDB":
            alias = self._attach(path, readonly=False, label=label)
            schema = options.get("schema", "main")
            self._execute(f"CREATE SCHEMA IF NOT EXISTS {q(alias)}.{q(schema)}", label)
            target = f"{q(alias)}.{q(schema)}.{q(options['table'])}"
            mode = options.get("mode", "error")
            if mode == "append":
                # BY NAME impide insertar datos en una columna distinta por posición.
                self._execute(f"INSERT INTO {target} BY NAME SELECT * FROM {table.sql}", label)
            else:
                create = "CREATE OR REPLACE TABLE" if mode == "replace" else "CREATE TABLE"
                self._execute(f"{create} {target} AS SELECT * FROM {table.sql}", label)
        elif driver in {"CSV", "PARQUET"}:
            settings = ["FORMAT " + driver]
            if driver == "CSV":
                settings.extend(["HEADER " + literal(options.get("header", True)),
                                 "DELIMITER " + literal(options.get("delimiter", ",")),
                                 "NULL " + literal(options.get("nullstr", ""))])
            self._execute(f"COPY {table.sql} TO {literal(str(path))} ({', '.join(settings)})", label)
        else:
            raise ExecutionError(f"{label}: conector SINK no soportado: {driver}.")
        self.written.append(str(path))
        return table


def run_pipelines(rt, pipelines, defaults, names=None, inputs=None):
    selected = defaults if names is None else names
    if not selected:
        raise ExecutionError("No hay pipelines raíz ejecutables; seleccione uno y enlace sus INPUT.")
    unknown = set(selected) - pipelines.keys()
    if unknown:
        raise ExecutionError(f"PIPELINE desconocido: {sorted(unknown)}.")
    return {name: pipelines[name](rt, (inputs or {}).get(name)) for name in selected}


def generated_main(pipelines, defaults, base_dir, argv=None):
    parser = argparse.ArgumentParser(description="Pipeline ETL generado para DuckDB")
    parser.add_argument("--pipeline", action="append", help="Nombre a ejecutar; repetible")
    parser.add_argument("--base-dir", default=base_dir, type=Path, help="Base de rutas de SOURCE/SINK")
    args = parser.parse_args(argv)
    try:
        with DuckDBRuntime(args.base_dir) as rt:
            results = run_pipelines(rt, pipelines, defaults, args.pipeline)
            for name in results:
                print(f"DUCKDB: PIPELINE {name} ejecutado.")
            for path in rt.written:
                print(f"SINK: {path}")
        return 0
    except (ExecutionError, duckdb.Error, OSError) as exc:
        print(exc, file=sys.stderr)
        return 1
