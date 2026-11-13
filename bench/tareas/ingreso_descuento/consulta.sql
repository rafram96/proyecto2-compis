COPY (
    SELECT sum(l_extendedprice * l_discount) AS ingreso_total
    FROM read_parquet('$datos/lineitem.parquet')
    WHERE l_discount BETWEEN 0.06 - 0.01 AND 0.06 + 0.01
      AND l_quantity < 24
) TO '$salida/ingreso_descuento.parquet' (FORMAT parquet);
