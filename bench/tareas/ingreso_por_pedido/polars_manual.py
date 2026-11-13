import polars as pl


def ejecutar(datos, salida, optimizaciones):
    clientes = pl.scan_parquet(datos / "customer.parquet").filter(pl.col("c_mktsegment") == "BUILDING")
    pedidos = pl.scan_parquet(datos / "orders.parquet")
    lineas = pl.scan_parquet(datos / "lineitem.parquet")
    (clientes
     .join(pedidos, left_on="c_custkey", right_on="o_custkey")
     .join(lineas, left_on="o_orderkey", right_on="l_orderkey")
     .group_by("o_orderkey", "o_orderdate", "o_shippriority")
     .agg(total=(pl.col("l_extendedprice") * (1 - pl.col("l_discount"))).sum())
     .sort(["total", "o_orderdate"], descending=[True, False])
     .collect(optimizations=optimizaciones)
     .write_parquet(salida / "ingreso_por_pedido.parquet"))
