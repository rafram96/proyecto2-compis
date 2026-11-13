import polars as pl


def ejecutar(datos, salida, optimizaciones):
    (pl.scan_parquet(datos / "lineitem.parquet")
     .filter(pl.col("l_discount").is_between(0.05, 0.07), pl.col("l_quantity") < 24)
     .select(ingreso_total=(pl.col("l_extendedprice") * pl.col("l_discount")).sum())
     .collect(optimizations=optimizaciones)
     .write_parquet(salida / "ingreso_descuento.parquet"))
