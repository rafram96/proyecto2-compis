"""Oráculos de equivalencia y corpus de fallos, fuera de los intervalos medidos."""
import re

import polars as pl
from polars.testing import assert_frame_equal

from etl_dsl import analyze
from etl_dsl.runtime import ExecutionError
from .data import generate


def equivalent(expected, actual, *, ordered=True):
    if expected.keys() != actual.keys():
        raise AssertionError(f"Puertos distintos: {expected.keys()}, {actual.keys()}")
    for name, left in expected.items():
        right = actual[name]
        if left.columns != right.columns or left.schema != right.schema or left.shape != right.shape:
            raise AssertionError(f"{name}: columnas, dtypes u dimensiones distintos")
        if left.null_count().row(0) != right.null_count().row(0):
            raise AssertionError(f"{name}: nulabilidad observable distinta")
        # Orden lexicográfico Polars de TODAS las columnas; conserva duplicados,
        # distingue NULL de NaN y no convierte valores a cadenas/hashes aproximados.
        if not ordered and left.width:
            left = left.sort(left.columns, nulls_last=True, maintain_order=True)
            right = right.sort(right.columns, nulls_last=True, maintain_order=True)
        assert_frame_equal(left, right, check_exact=True)


def invalid_inputs():
    data = generate(32, 81)
    # Garantiza que los filtros anteriores al JOIN de combinado dejen filas.
    data["ventas"] = data["ventas"].with_columns(pl.lit(200.0).alias("monto"))
    left, right = data["ventas"], data["clientes"]
    variants = [
        ("duplicado_derecho", "E_JOIN_UNIQUE", {**data, "clientes": pl.concat([right, right.head(1)])}),
        ("duplicado_con_izquierda_vacia", "E_JOIN_UNIQUE", {
            "ventas": left.head(0), "clientes": pl.concat([right, right.head(1)])}),
        ("referencia_ausente", "E_JOIN_REFERENCE", {**data, "ventas": left.with_columns(
            pl.lit(999_999, dtype=pl.Int64).alias("cliente"))}),
        ("derecha_vacia", "E_JOIN_REFERENCE", {**data, "clientes": right.head(0)}),
        ("clave_izquierda_null", "E_JOIN_NULL", {**data, "ventas": left.with_columns(
            pl.lit(None, dtype=pl.Int64).alias("cliente"))}),
        ("clave_derecha_null", "E_JOIN_NULL", {**data, "clientes": right.with_columns(
            pl.lit(None, dtype=pl.Int64).alias("clave"))}),
        ("dtype_fisico", "E_JOIN_KEY_TYPE", {**data, "clientes": right.cast({"clave": pl.Int32})}),
        ("contrato_no_clave", "E_NULL", {**data, "clientes": right.with_columns(
            pl.lit(None, dtype=pl.String).alias("nombre"))}),
        ("contrato_izquierdo", "E_NULL", {**data, "ventas": left.with_columns(
            pl.lit(None, dtype=pl.Int64).alias("id"))}),
        ("columnas_entrada", "E_SCHEMA", {**data, "ventas": left.select("cliente", "id", "monto", "etiqueta")}),
        ("tipo_entrada", "E_TYPE", {**data, "ventas": left.with_columns(pl.col("monto").cast(pl.String))}),
    ]
    return variants


def check_contract_errors(functions, execute):
    records = []
    for workload in ("join", "combinado", "control_join"):
        for case, code, frames in invalid_inputs():
            for configuration, fn in functions[workload].items():
                try:
                    # Incluye invocación y collect: un chequeo perdido no cuenta como éxito.
                    execute(fn, frames, "normal")
                except ExecutionError as exc:
                    match = re.search(r"\bE_[A-Z_]+\b", str(exc))
                    actual = match.group(0) if match else None
                    if actual != code:
                        raise AssertionError(f"{workload}/{case}/{configuration}: {actual} != {code}") from exc
                else:
                    raise AssertionError(f"{workload}/{case}/{configuration}: no rechazó {code}")
                records.append({"phase": "runtime", "workload": workload, "case": case,
                                "configuration": configuration, "expected": code, "observed": code,
                                "plain_polars": "sin estos contratos no garantiza rechazar el dato"})
    return records


def check_static_errors(sources, configurations):
    join = sources["join"]
    cases = [
        ("columna_ausente", sources["rangos"].replace("COLUMNS id, monto", "COLUMNS ausente, monto"),
         "E_COLUMN", lambda: generate(1, 2)["ventas"].lazy().select("ausente").collect()),
        ("predicado_numerico", sources["rangos"].replace("WHERE monto >= 100 AND monto < 900", "WHERE monto + 1"),
         "E_TYPE", lambda: generate(1, 2)["ventas"].lazy().filter(pl.col("monto") + 1).collect()),
        ("tipos_join", join.replace("clave: INT?", "clave: STRING?"), "E_TYPE",
         lambda: pl.DataFrame({"a": [1]}).lazy().join(pl.DataFrame({"b": ["1"]}).lazy(),
                 left_on="a", right_on="b").collect()),
    ]
    records = []
    for case, source, code, plain in cases:
        try:
            plain()
        except pl.exceptions.PolarsError as exc:
            plain_result = f"al materializar: {type(exc).__name__}"
        else:
            raise AssertionError(f"El control Polars {case} no falló")
        for configuration, passes in configurations.items():
            result = analyze(source, passes=passes, artifacts=("python",))
            codes = [d.code for d in result.diagnostics]
            if result.ok or code not in codes:
                raise AssertionError(f"{case}/{configuration}: {codes} != {code}")
            records.append({"phase": "compile", "workload": "corpus", "case": case,
                            "configuration": configuration, "expected": code, "observed": code,
                            "plain_polars": plain_result})
    return records
