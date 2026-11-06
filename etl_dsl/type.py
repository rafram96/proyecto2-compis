"""Tipos escalares y compatibilidad con los esquemas obtenidos desde Polars."""
from enum import Enum


class ScalarType(str, Enum):
    INT = "INT"
    DECIMAL = "DECIMAL"
    STRING = "STRING"
    BOOL = "BOOL"
    DATE = "DATE"
    DATETIME = "DATETIME"


def accepts_polars(expected: str, actual) -> bool:
    """Compatibilidad sin casts implícitos ni cambios de precisión en los datos.

    DECIMAL es la familia numérica del DSL v0.2, sin precisión/escala declarada.
    Incluye los reales inferidos por CSV/SQLite; se conserva el tipo del origen.
    `actual` es un tipo de Polars (pl.DataType).
    """
    if expected == "INT":
        return actual.is_integer()
    if expected == "DECIMAL":
        return actual.is_numeric()
    if expected == "DATETIME":
        return actual.base_type().__name__ == "Datetime"
    return actual.base_type().__name__ == {"STRING": "String", "BOOL": "Boolean", "DATE": "Date"}.get(expected)
