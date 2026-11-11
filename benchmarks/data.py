"""Datos en memoria; random.Random local evita depender del estado global."""
from hashlib import sha256
from io import BytesIO
import random

import polars as pl


VENTAS = {"id": pl.Int64, "cliente": pl.Int64, "monto": pl.Float64, "etiqueta": pl.String}
CLIENTES = {"clave": pl.Int64, "nombre": pl.String, "peso": pl.Int64}
# Incluye ambos extremos, valores adyacentes, NULL, NaN e infinitos.
LIMITES = (None, -1.0, 0.0, 99.0, 100.0, 101.0, 899.0, 900.0,
           901.0, float("nan"), float("inf"), float("-inf"))


def generate(size: int, seed: int) -> dict[str, pl.DataFrame]:
    if size < 0:
        raise ValueError("size debe ser no negativo")
    rng = random.Random(seed)
    dimension = max(2, min(10_000, size // 10))
    keys = [rng.randrange(dimension) for _ in range(size)]
    amounts = [LIMITES[i] if i < len(LIMITES) else
               (None if rng.randrange(11) == 0 else float(rng.randrange(-100, 1101)))
               for i in range(size)]
    tags = [rng.choice((None, "", "web", "tienda", "Ñandú", "東京")) for _ in range(size)]
    # Un grupo con todas sus medidas NULL, útil para SUM SQL.
    for i in range(0, size, 17):
        tags[i], amounts[i] = "solo_null", None
    order = list(range(size))
    rng.shuffle(order)  # El orden C4 no coincide accidentalmente con SORT id.
    rows = [(i, keys[i], amounts[i], tags[i]) for i in order]
    right = list(range(dimension))
    rng.shuffle(right)
    return {
        "ventas": pl.DataFrame(rows, schema=VENTAS, orient="row"),
        "clientes": pl.DataFrame([(k, f"cliente-{k}", None if k % 7 == 0 else k % 5)
                                  for k in right], schema=CLIENTES, orient="row"),
    }


def describe(frames):
    """Hash IPC sin compresión: identidad de datos/tipos/orden, no tiempo de generación."""
    result = {}
    for name, frame in frames.items():
        stream = BytesIO()
        frame.write_ipc(stream, compression="uncompressed")
        result[name] = {"rows": frame.height, "schema": {k: str(v) for k, v in frame.schema.items()},
                        "null_counts": frame.null_count().row(0, named=True),
                        "sha256_ipc": sha256(stream.getvalue()).hexdigest()}
    return result


def edge_inputs():
    regular = generate(32, 991)
    yield "limites_null_nan", regular
    yield "izquierda_vacia", {**regular, "ventas": regular["ventas"].head(0)}
    yield "ambas_vacias", {k: f.head(0) for k, f in regular.items()}
    yield "medidas_nulas", {**regular, "ventas": regular["ventas"].with_columns(
        pl.lit(None, dtype=pl.Float64).alias("monto"))}
    # Multiplicidad exacta, también para el comparador sin orden.
    yield "duplicados", {**regular, "ventas": pl.concat([regular["ventas"]] * 2)}
