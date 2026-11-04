"""Delimitación SQL compartida por el generador y el runtime DuckDB."""
from decimal import Decimal


def identifier(name: str) -> str:
    if "\0" in name:
        raise ValueError("Un identificador SQL no puede contener NUL.")
    return '"' + name.replace('"', '""') + '"'


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, Decimal)):
        return str(value)
    if isinstance(value, str):
        if "\0" in value:
            raise ValueError("Una cadena SQL no puede contener NUL.")
        return "'" + value.replace("'", "''") + "'"
    raise ValueError(f"Literal SQL no soportado: {type(value).__name__}.")
