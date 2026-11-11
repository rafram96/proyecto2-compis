"""Polars manual idiomático con los mismos contratos que los programas DSL.

No usa IR ni Python generado. Se comparte el runtime contractual público para
evitar que una validación manual más débil altere el coste o los errores de C4.
"""
import polars as pl


VENTAS = [("id", "INT", False), ("cliente", "INT", True),
          ("monto", "DECIMAL", True), ("etiqueta", "STRING", True)]
CLIENTES = [("clave", "INT", True), ("nombre", "STRING", False), ("peso", "INT", True)]


def inputs(rt, frames, with_join=False):
    left = rt.input(frames, "ventas", VENTAS, "baseline.ventas")
    if not with_join:
        return left
    right = rt.input(frames, "clientes", CLIENTES, "baseline.clientes")
    return left, right


def output(rt, table):
    return {"resultado": rt.contract(table, None, "baseline.resultado")}


def sql_sum(name, alias="total"):
    col = pl.col(name)
    return pl.when(col.count() > 0).then(col.sum()).alias(alias)


def rangos(rt, frames):
    left = inputs(rt, frames)
    return output(rt, left.filter((pl.col("monto") > 100) & (pl.col("monto") < 900))
                  .select("id", "monto").sort("id", nulls_last=True, maintain_order=True))


def clasicas(rt, frames):
    left = inputs(rt, frames)
    return output(rt, left.filter((pl.col("monto") < 900) & pl.col("etiqueta").is_not_null())
                  .with_columns((pl.col("monto") * 5).alias("ajustado"))
                  .sort("id", nulls_last=True, maintain_order=True))


def join(rt, frames):
    left, right = inputs(rt, frames, True)
    left, right = rt.verify_many_to_one(left, right, "cliente", "clave", "baseline.union")
    return output(rt, left.join(right, left_on="cliente", right_on="clave", how="inner",
                                coalesce=False, maintain_order="left")
                  .select("id", "cliente", "monto", "etiqueta"))


def combinado(rt, frames):
    left, right = inputs(rt, frames, True)
    left = left.filter((pl.col("monto") >= 100) & (pl.col("monto") < 900))
    left, right = rt.verify_many_to_one(left, right, "cliente", "clave", "baseline.union")
    table = (left.join(right, left_on="cliente", right_on="clave", how="inner",
                       coalesce=False, maintain_order="left")
             .select("id", "cliente", "monto", "etiqueta")
             .filter(pl.col("etiqueta").is_not_null() & (pl.col("id") >= 0))
             .with_columns((pl.col("monto") * 5).alias("ajustado"))
             .group_by("cliente", maintain_order=True)
             .agg(sql_sum("ajustado"), pl.len().cast(pl.Int64).alias("n"))
             .sort("cliente", nulls_last=True, maintain_order=True))
    return output(rt, table)


def control_limites(rt, frames):
    left = inputs(rt, frames)
    return output(rt, left.filter(pl.col("monto") > 100)
                  .sort("id", nulls_last=True, maintain_order=True))


def control_join(rt, frames):
    left, right = inputs(rt, frames, True)
    left, right = rt.verify_many_to_one(left, right, "cliente", "clave", "baseline.union")
    return output(rt, left.join(right, left_on="cliente", right_on="clave", how="inner",
                                coalesce=False, maintain_order="left")
                  .select("id", "cliente", "clave", "monto", "nombre"))


def control_sin_garantia(rt, frames):
    left, right = inputs(rt, frames, True)
    return output(rt, left.join(right, left_on="cliente", right_on="clave", how="inner",
                                coalesce=False)
                  .select("id", "cliente", "clave", "monto", "nombre"))


def agregados(rt, frames):
    left = inputs(rt, frames)
    aggregations = [sql_sum("monto"), pl.len().cast(pl.Int64).alias("n"),
                    pl.col("monto").count().cast(pl.Int64).alias("presentes")]
    return {"resultado": rt.contract(left.group_by("etiqueta", maintain_order=True)
                                      .agg(aggregations), None, "baseline.resultado"),
            "totales": rt.contract(left.select(aggregations), None, "baseline.totales")}


BASELINES = {fn.__name__: fn for fn in (rangos, clasicas, join, combinado,
                                       control_limites, control_join, control_sin_garantia, agregados)}
