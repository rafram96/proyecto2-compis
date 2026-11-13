COPY (
    SELECT o_orderkey, o_orderdate, o_shippriority,
           sum(l_extendedprice * (1 - l_discount)) AS total
    FROM read_parquet('$datos/customer.parquet') c
    JOIN read_parquet('$datos/orders.parquet') o ON c.c_custkey = o.o_custkey
    JOIN read_parquet('$datos/lineitem.parquet') l ON o.o_orderkey = l.l_orderkey
    WHERE c_mktsegment = 'BUILDING'
    GROUP BY o_orderkey, o_orderdate, o_shippriority
    ORDER BY total DESC, o_orderdate
) TO '$salida/ingreso_por_pedido.parquet' (FORMAT parquet);
