import pandas as pd


def ejecutar(datos, salida, _):
    df = pd.read_parquet(datos / "orders_sucio.parquet")
    df = df.dropna(subset=["o_orderpriority"])
    df["o_totalprice"] = df["o_totalprice"].fillna(0)
    df = df.drop_duplicates()
    resumen = (df.groupby("o_orderpriority", as_index=False)
                 .agg(pedidos=("o_totalprice", "size"),
                      total=("o_totalprice", "sum"),
                      promedio=("o_totalprice", "mean"))
                 .sort_values("o_orderpriority"))
    resumen.to_parquet(salida / "limpieza_pedidos.parquet", index=False)
