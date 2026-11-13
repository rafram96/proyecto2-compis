import pandas as pd


def ejecutar(datos, salida, _):
    clientes = pd.read_parquet(datos / "customer.parquet", columns=["c_custkey", "c_mktsegment"])
    clientes = clientes[clientes["c_mktsegment"] == "BUILDING"]
    pedidos = pd.read_parquet(datos / "orders.parquet",
                              columns=["o_orderkey", "o_custkey", "o_orderdate", "o_shippriority"])
    lineas = pd.read_parquet(datos / "lineitem.parquet",
                             columns=["l_orderkey", "l_extendedprice", "l_discount"])
    unidos = (clientes.merge(pedidos, left_on="c_custkey", right_on="o_custkey")
                      .merge(lineas, left_on="o_orderkey", right_on="l_orderkey"))
    unidos["ingreso"] = unidos["l_extendedprice"] * (1 - unidos["l_discount"])
    resultado = (unidos.groupby(["o_orderkey", "o_orderdate", "o_shippriority"], as_index=False)
                       .agg(total=("ingreso", "sum"))
                       .sort_values(["total", "o_orderdate"], ascending=[False, True]))
    resultado.to_parquet(salida / "ingreso_por_pedido.parquet", index=False)
