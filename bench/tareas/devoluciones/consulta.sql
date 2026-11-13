CREATE TEMP TABLE devueltas AS
    SELECT * FROM read_parquet('$datos/lineitem.parquet') WHERE l_returnflag = 'R';

COPY devueltas TO '$salida/devoluciones.parquet' (FORMAT parquet);

COPY (
    SELECT l_shipmode, count(*) AS lineas, sum(l_extendedprice) AS total
    FROM devueltas
    GROUP BY l_shipmode
    ORDER BY l_shipmode
) TO '$salida/devoluciones_por_envio.parquet' (FORMAT parquet);
