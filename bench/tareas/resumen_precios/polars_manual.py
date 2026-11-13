import polars as pl


def ejecutar(datos, salida, optimizaciones):
    precio_desc = pl.col("l_extendedprice") * (1 - pl.col("l_discount"))
    (pl.scan_parquet(datos / "lineitem.parquet")
     .with_columns(precio_desc=precio_desc)
     .with_columns(cargo=pl.col("precio_desc") * (1 + pl.col("l_tax")))
     .group_by("l_returnflag", "l_linestatus")
     .agg(sum_qty=pl.col("l_quantity").sum(),
          sum_base_price=pl.col("l_extendedprice").sum(),
          sum_disc_price=pl.col("precio_desc").sum(),
          sum_charge=pl.col("cargo").sum(),
          avg_qty=pl.col("l_quantity").mean(),
          avg_price=pl.col("l_extendedprice").mean(),
          avg_disc=pl.col("l_discount").mean(),
          count_order=pl.len())
     .sort("l_returnflag", "l_linestatus")
     .collect(optimizations=optimizaciones)
     .write_parquet(salida / "resumen_precios.parquet"))
