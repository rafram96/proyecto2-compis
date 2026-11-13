import polars as pl


def ejecutar(datos, salida, optimizaciones):
    # Se calcula una vez y se reutiliza para las dos salidas.
    devueltas = (pl.scan_parquet(datos / "lineitem.parquet")
                 .filter(pl.col("l_returnflag") == "R")
                 .collect(optimizations=optimizaciones))
    devueltas.write_parquet(salida / "devoluciones.parquet")
    (devueltas.group_by("l_shipmode")
     .agg(lineas=pl.len(), total=pl.col("l_extendedprice").sum())
     .sort("l_shipmode")
     .write_parquet(salida / "devoluciones_por_envio.parquet"))
