COPY (
    WITH limpios AS (
        SELECT DISTINCT o_orderkey, o_custkey, o_orderstatus,
               coalesce(o_totalprice, 0) AS o_totalprice,
               o_orderdate, o_orderpriority, o_clerk, o_shippriority
        FROM read_parquet('$datos/orders_sucio.parquet')
        WHERE o_orderpriority IS NOT NULL
    )
    SELECT o_orderpriority,
           count(*) AS pedidos,
           sum(o_totalprice) AS total,
           avg(o_totalprice) AS promedio
    FROM limpios
    GROUP BY o_orderpriority
    ORDER BY o_orderpriority
) TO '$salida/limpieza_pedidos.parquet' (FORMAT parquet);
