import polars as pl


def ejecutar(datos, salida, optimizaciones):
    (pl.scan_parquet(datos / "orders_sucio.parquet")
     .drop_nulls("o_orderpriority")
     .with_columns(pl.col("o_totalprice").fill_null(0))
     .unique()
     .group_by("o_orderpriority")
     .agg(pedidos=pl.len(),
          total=pl.col("o_totalprice").sum(),
          promedio=pl.col("o_totalprice").mean())
     .sort("o_orderpriority")
     .collect(optimizations=optimizaciones)
     .write_parquet(salida / "limpieza_pedidos.parquet"))
