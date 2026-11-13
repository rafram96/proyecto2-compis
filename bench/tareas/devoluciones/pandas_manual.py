import pandas as pd


def ejecutar(datos, salida, _):
    df = pd.read_parquet(datos / "lineitem.parquet")
    devueltas = df[df["l_returnflag"] == "R"]
    devueltas.to_parquet(salida / "devoluciones.parquet", index=False)
    resumen = (devueltas.groupby("l_shipmode", as_index=False)
                        .agg(lineas=("l_extendedprice", "size"), total=("l_extendedprice", "sum"))
                        .sort_values("l_shipmode"))
    resumen.to_parquet(salida / "devoluciones_por_envio.parquet", index=False)
