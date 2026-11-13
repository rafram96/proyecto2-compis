import pandas as pd


def ejecutar(datos, salida, _):
    columnas = ["l_returnflag", "l_linestatus", "l_quantity", "l_extendedprice", "l_discount", "l_tax"]
    df = pd.read_parquet(datos / "lineitem.parquet", columns=columnas)
    df["precio_desc"] = df["l_extendedprice"] * (1 - df["l_discount"])
    df["cargo"] = df["precio_desc"] * (1 + df["l_tax"])
    resumen = (df.groupby(["l_returnflag", "l_linestatus"], as_index=False)
                 .agg(sum_qty=("l_quantity", "sum"),
                      sum_base_price=("l_extendedprice", "sum"),
                      sum_disc_price=("precio_desc", "sum"),
                      sum_charge=("cargo", "sum"),
                      avg_qty=("l_quantity", "mean"),
                      avg_price=("l_extendedprice", "mean"),
                      avg_disc=("l_discount", "mean"),
                      count_order=("l_quantity", "size"))
                 .sort_values(["l_returnflag", "l_linestatus"]))
    resumen.to_parquet(salida / "resumen_precios.parquet", index=False)
