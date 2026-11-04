"""Tipos escalares y compatibilidad con los esquemas obtenidos desde DuckDB."""
from enum import Enum


class ScalarType(str, Enum):
    INT = "INT"
    DECIMAL = "DECIMAL"
    STRING = "STRING"
    BOOL = "BOOL"
    DATE = "DATE"
    DATETIME = "DATETIME"


def accepts_duckdb(expected: str, actual: str) -> bool:
    """Compatibilidad sin casts implícitos ni cambios de precisión en los datos.

    DECIMAL es la familia numérica del DSL v0.2, sin precisión/escala declarada.
    Incluye los reales inferidos por CSV/SQLite; se conserva el tipo del origen.
    """
    integral = {"TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT",
                "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT"}
    if expected == "INT":
        return actual in integral
    if expected == "DECIMAL":
        return actual in integral | {"FLOAT", "DOUBLE"} or actual.startswith("DECIMAL(")
    if expected == "DATETIME":
        return actual.startswith("TIMESTAMP")
    return actual == {"STRING": "VARCHAR", "BOOL": "BOOLEAN", "DATE": "DATE"}.get(expected)
