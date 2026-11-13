import pandas as pd


def ejecutar(datos, salida, _):
    df = pd.read_parquet(datos / "lineitem.parquet",
                         columns=["l_extendedprice", "l_discount", "l_quantity"])
    filtrado = df[df["l_discount"].between(0.05, 0.07) & (df["l_quantity"] < 24)]
    ingreso = (filtrado["l_extendedprice"] * filtrado["l_discount"]).sum()
    pd.DataFrame({"ingreso_total": [ingreso]}).to_parquet(salida / "ingreso_descuento.parquet", index=False)
