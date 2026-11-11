# Cauce C5: resultados medidos

Campaña **measure** válida. Inicio UTC: 2026-11-11T20:38:57.911816+00:00.
Son mediciones de esta máquina; no son cifras de ejemplo ni evidencia de significancia estadística.

Python `3.13.13`, Polars `2.1.0`, Lark `1.3.1`; Apple M5 Pro; macOS-27.2-arm64-arm-64bit-Mach-O; 4 hilos Polars.
Revisión base `efe13996d9201788c9fc8cd7c6f458ca68035a04`; estado y hashes exactos del código en `metadata.json`.

Semilla 20261111; tamaños [10000, 200000, 1000000]; 2 calentamientos y 10 repeticiones por celda; orden barajado con la semilla.
Datos en memoria generados de nuevo; dimensión derecha = max(2, min(10000, filas // 10)). Generación, comparación, carga del Python y exportación quedan fuera de los tiempos.

Compilación: API pública analyze con artefacto python (scanner, parser, AST, validación, lowering, inferencia, pases y generación). size=0 significa independiente del dataset; no mide una entrada vacía. No hay tiempo de compilación para el baseline manual.

Ejecución: nuevo runtime, invocación del pipeline o baseline y materialización de TODAS las salidas. Incluye contratos, snapshots y anti join C4; no mide únicamente collect(). El baseline manual conserva las mismas garantías mediante el runtime público, y el JOIN conserva ambas claves.

`normal`: collect() habitual en salidas y validaciones, engine=auto. `final_flags_none`: QueryOptFlags.none() solo en los collect finales, engine=auto; validaciones/snapshots/anti join internos mantienen opciones habituales. No es Polars sin optimización; type_check/type_coercion permanecen según los flags registrados en metadata.json.

Equivalencia previa: 1024 comprobaciones (más cada ejecución cronometrada). Corpus separado: 285 errores esperados conservados. Se verifican puertos, columnas y orden, dtypes, forma, nulos y valores exactos, incluidos NULL/NaN. Orden de filas conservado salvo control_sin_garantia: allí se ordenan todas las columnas lexicográficamente sin eliminar multiplicidad. Casos: vacíos, límites, todos NULL y duplicados.

## Tiempos

Mediana e IQR en **ms**; IQR = P75 − P25 con interpolación lineal. Razón = mediana O0 / mediana de la configuración para igual workload, tamaño, fase y escenario. Mayor que 1 indica menos tiempo; menor que 1, regresión observada. No compara compilación con ejecución.

| Fase | Workload | Filas | Motor | Configuración | Mediana ms | IQR ms | O0/config |
|---|---|---:|---|---|---:|---:|---:|
| compile | agregados | 0 | not_applicable | O0 | 1.2089 | 0.1289 | 1.000 |
| compile | agregados | 0 | not_applicable | constantes | 1.2592 | 0.2478 | 0.960 |
| compile | agregados | 0 | not_applicable | default | 1.4427 | 0.2217 | 0.838 |
| compile | agregados | 0 | not_applicable | filtros | 1.1446 | 0.1504 | 1.056 |
| compile | agregados | 0 | not_applicable | joins | 1.3022 | 0.3800 | 0.928 |
| compile | agregados | 0 | not_applicable | muertos | 1.1397 | 0.0607 | 1.061 |
| compile | agregados | 0 | not_applicable | rangos | 1.2420 | 0.1348 | 0.973 |
| compile | clasicas | 0 | not_applicable | O0 | 2.1498 | 1.6172 | 1.000 |
| compile | clasicas | 0 | not_applicable | constantes | 1.6646 | 0.3261 | 1.291 |
| compile | clasicas | 0 | not_applicable | default | 2.1957 | 0.8924 | 0.979 |
| compile | clasicas | 0 | not_applicable | filtros | 1.7573 | 0.2511 | 1.223 |
| compile | clasicas | 0 | not_applicable | joins | 2.6338 | 1.4085 | 0.816 |
| compile | clasicas | 0 | not_applicable | muertos | 1.8736 | 0.2811 | 1.147 |
| compile | clasicas | 0 | not_applicable | rangos | 2.0182 | 0.1003 | 1.065 |
| compile | combinado | 0 | not_applicable | O0 | 2.7172 | 0.3278 | 1.000 |
| compile | combinado | 0 | not_applicable | constantes | 3.1754 | 2.1527 | 0.856 |
| compile | combinado | 0 | not_applicable | default | 3.6514 | 1.3854 | 0.744 |
| compile | combinado | 0 | not_applicable | filtros | 3.2649 | 1.3736 | 0.832 |
| compile | combinado | 0 | not_applicable | joins | 3.1807 | 0.5112 | 0.854 |
| compile | combinado | 0 | not_applicable | muertos | 2.6757 | 0.1101 | 1.016 |
| compile | combinado | 0 | not_applicable | rangos | 3.2141 | 0.4815 | 0.845 |
| compile | control_join | 0 | not_applicable | O0 | 1.2232 | 0.4685 | 1.000 |
| compile | control_join | 0 | not_applicable | constantes | 1.2109 | 0.2584 | 1.010 |
| compile | control_join | 0 | not_applicable | default | 1.3165 | 0.1203 | 0.929 |
| compile | control_join | 0 | not_applicable | filtros | 1.4612 | 0.5390 | 0.837 |
| compile | control_join | 0 | not_applicable | joins | 1.3543 | 0.4734 | 0.903 |
| compile | control_join | 0 | not_applicable | muertos | 1.1227 | 0.2312 | 1.090 |
| compile | control_join | 0 | not_applicable | rangos | 1.2660 | 0.1307 | 0.966 |
| compile | control_limites | 0 | not_applicable | O0 | 1.0429 | 0.3138 | 1.000 |
| compile | control_limites | 0 | not_applicable | constantes | 1.1370 | 0.1326 | 0.917 |
| compile | control_limites | 0 | not_applicable | default | 1.2326 | 0.3462 | 0.846 |
| compile | control_limites | 0 | not_applicable | filtros | 1.1396 | 0.5219 | 0.915 |
| compile | control_limites | 0 | not_applicable | joins | 1.0069 | 0.0744 | 1.036 |
| compile | control_limites | 0 | not_applicable | muertos | 1.0532 | 0.3453 | 0.990 |
| compile | control_limites | 0 | not_applicable | rangos | 1.1652 | 0.5339 | 0.895 |
| compile | control_sin_garantia | 0 | not_applicable | O0 | 1.3707 | 1.3490 | 1.000 |
| compile | control_sin_garantia | 0 | not_applicable | constantes | 1.5295 | 0.6929 | 0.896 |
| compile | control_sin_garantia | 0 | not_applicable | default | 2.3864 | 1.1648 | 0.574 |
| compile | control_sin_garantia | 0 | not_applicable | filtros | 1.6572 | 0.3959 | 0.827 |
| compile | control_sin_garantia | 0 | not_applicable | joins | 1.5621 | 0.5523 | 0.877 |
| compile | control_sin_garantia | 0 | not_applicable | muertos | 1.5918 | 0.8042 | 0.861 |
| compile | control_sin_garantia | 0 | not_applicable | rangos | 1.6940 | 1.0968 | 0.809 |
| compile | join | 0 | not_applicable | O0 | 1.2116 | 0.3656 | 1.000 |
| compile | join | 0 | not_applicable | constantes | 1.1687 | 0.1917 | 1.037 |
| compile | join | 0 | not_applicable | default | 1.4818 | 0.2164 | 0.818 |
| compile | join | 0 | not_applicable | filtros | 1.1191 | 0.1202 | 1.083 |
| compile | join | 0 | not_applicable | joins | 1.1658 | 0.0896 | 1.039 |
| compile | join | 0 | not_applicable | muertos | 1.0787 | 0.3777 | 1.123 |
| compile | join | 0 | not_applicable | rangos | 1.2620 | 0.4166 | 0.960 |
| compile | rangos | 0 | not_applicable | O0 | 2.1709 | 0.8596 | 1.000 |
| compile | rangos | 0 | not_applicable | constantes | 1.5221 | 0.1115 | 1.426 |
| compile | rangos | 0 | not_applicable | default | 1.9305 | 0.3274 | 1.125 |
| compile | rangos | 0 | not_applicable | filtros | 1.6330 | 0.2715 | 1.329 |
| compile | rangos | 0 | not_applicable | joins | 1.4567 | 0.6452 | 1.490 |
| compile | rangos | 0 | not_applicable | muertos | 1.4047 | 0.0984 | 1.545 |
| compile | rangos | 0 | not_applicable | rangos | 1.7055 | 0.5607 | 1.273 |
| execute | agregados | 10000 | final_flags_none | O0 | 0.5985 | 0.0973 | 1.000 |
| execute | agregados | 10000 | normal | O0 | 0.6460 | 0.1812 | 1.000 |
| execute | agregados | 10000 | final_flags_none | constantes | 0.5671 | 0.1161 | 1.056 |
| execute | agregados | 10000 | normal | constantes | 0.5114 | 0.0457 | 1.263 |
| execute | agregados | 10000 | final_flags_none | default | 0.5667 | 0.0561 | 1.056 |
| execute | agregados | 10000 | normal | default | 0.5766 | 0.1526 | 1.120 |
| execute | agregados | 10000 | final_flags_none | filtros | 0.5584 | 0.1108 | 1.072 |
| execute | agregados | 10000 | normal | filtros | 0.5593 | 0.1360 | 1.155 |
| execute | agregados | 10000 | final_flags_none | joins | 0.5593 | 0.2902 | 1.070 |
| execute | agregados | 10000 | normal | joins | 0.5383 | 0.0226 | 1.200 |
| execute | agregados | 10000 | final_flags_none | manual | 0.5869 | 0.1317 | 1.020 |
| execute | agregados | 10000 | normal | manual | 0.5575 | 0.0965 | 1.159 |
| execute | agregados | 10000 | final_flags_none | muertos | 0.6502 | 0.6514 | 0.921 |
| execute | agregados | 10000 | normal | muertos | 0.6501 | 0.2157 | 0.994 |
| execute | agregados | 10000 | final_flags_none | rangos | 0.5995 | 0.1434 | 0.998 |
| execute | agregados | 10000 | normal | rangos | 0.6449 | 0.1446 | 1.002 |
| execute | agregados | 1000000 | final_flags_none | O0 | 3.7489 | 0.3451 | 1.000 |
| execute | agregados | 1000000 | normal | O0 | 3.9562 | 1.4560 | 1.000 |
| execute | agregados | 1000000 | final_flags_none | constantes | 3.7154 | 0.2767 | 1.009 |
| execute | agregados | 1000000 | normal | constantes | 3.8093 | 0.5903 | 1.039 |
| execute | agregados | 1000000 | final_flags_none | default | 3.9355 | 0.3444 | 0.953 |
| execute | agregados | 1000000 | normal | default | 3.5889 | 0.7851 | 1.102 |
| execute | agregados | 1000000 | final_flags_none | filtros | 3.7882 | 0.7604 | 0.990 |
| execute | agregados | 1000000 | normal | filtros | 3.7900 | 1.1511 | 1.044 |
| execute | agregados | 1000000 | final_flags_none | joins | 3.8400 | 0.3845 | 0.976 |
| execute | agregados | 1000000 | normal | joins | 3.8051 | 1.4705 | 1.040 |
| execute | agregados | 1000000 | final_flags_none | manual | 4.0743 | 1.6029 | 0.920 |
| execute | agregados | 1000000 | normal | manual | 3.9865 | 0.8309 | 0.992 |
| execute | agregados | 1000000 | final_flags_none | muertos | 3.6713 | 0.4893 | 1.021 |
| execute | agregados | 1000000 | normal | muertos | 3.9667 | 1.2527 | 0.997 |
| execute | agregados | 1000000 | final_flags_none | rangos | 3.7492 | 0.2664 | 1.000 |
| execute | agregados | 1000000 | normal | rangos | 4.3855 | 1.1881 | 0.902 |
| execute | agregados | 200000 | final_flags_none | O0 | 1.1582 | 0.2265 | 1.000 |
| execute | agregados | 200000 | normal | O0 | 1.1771 | 0.1434 | 1.000 |
| execute | agregados | 200000 | final_flags_none | constantes | 1.3287 | 0.3958 | 0.872 |
| execute | agregados | 200000 | normal | constantes | 1.4144 | 0.5601 | 0.832 |
| execute | agregados | 200000 | final_flags_none | default | 1.1937 | 0.1025 | 0.970 |
| execute | agregados | 200000 | normal | default | 1.3138 | 0.8672 | 0.896 |
| execute | agregados | 200000 | final_flags_none | filtros | 1.4051 | 0.4490 | 0.824 |
| execute | agregados | 200000 | normal | filtros | 1.1454 | 0.1324 | 1.028 |
| execute | agregados | 200000 | final_flags_none | joins | 1.1774 | 0.1204 | 0.984 |
| execute | agregados | 200000 | normal | joins | 1.2267 | 0.3237 | 0.960 |
| execute | agregados | 200000 | final_flags_none | manual | 1.3364 | 0.4231 | 0.867 |
| execute | agregados | 200000 | normal | manual | 1.2322 | 0.1561 | 0.955 |
| execute | agregados | 200000 | final_flags_none | muertos | 1.1870 | 0.1322 | 0.976 |
| execute | agregados | 200000 | normal | muertos | 1.1700 | 0.2108 | 1.006 |
| execute | agregados | 200000 | final_flags_none | rangos | 1.1389 | 0.1521 | 1.017 |
| execute | agregados | 200000 | normal | rangos | 1.3558 | 0.5927 | 0.868 |
| execute | clasicas | 10000 | final_flags_none | O0 | 0.7903 | 0.5352 | 1.000 |
| execute | clasicas | 10000 | normal | O0 | 0.7386 | 0.6115 | 1.000 |
| execute | clasicas | 10000 | final_flags_none | constantes | 0.5806 | 0.6134 | 1.361 |
| execute | clasicas | 10000 | normal | constantes | 0.8694 | 0.6392 | 0.850 |
| execute | clasicas | 10000 | final_flags_none | default | 0.5247 | 0.1457 | 1.506 |
| execute | clasicas | 10000 | normal | default | 0.6222 | 0.4522 | 1.187 |
| execute | clasicas | 10000 | final_flags_none | filtros | 0.6461 | 0.2447 | 1.223 |
| execute | clasicas | 10000 | normal | filtros | 0.5870 | 0.4351 | 1.258 |
| execute | clasicas | 10000 | final_flags_none | joins | 0.7143 | 0.6873 | 1.106 |
| execute | clasicas | 10000 | normal | joins | 0.7326 | 0.2604 | 1.008 |
| execute | clasicas | 10000 | final_flags_none | manual | 0.5217 | 0.1299 | 1.515 |
| execute | clasicas | 10000 | normal | manual | 0.5960 | 0.5580 | 1.239 |
| execute | clasicas | 10000 | final_flags_none | muertos | 0.6469 | 0.2368 | 1.222 |
| execute | clasicas | 10000 | normal | muertos | 0.9730 | 0.6236 | 0.759 |
| execute | clasicas | 10000 | final_flags_none | rangos | 0.7347 | 0.1343 | 1.076 |
| execute | clasicas | 10000 | normal | rangos | 0.6298 | 0.1706 | 1.173 |
| execute | clasicas | 1000000 | final_flags_none | O0 | 17.4913 | 1.6287 | 1.000 |
| execute | clasicas | 1000000 | normal | O0 | 15.7956 | 1.6553 | 1.000 |
| execute | clasicas | 1000000 | final_flags_none | constantes | 17.5741 | 1.7101 | 0.995 |
| execute | clasicas | 1000000 | normal | constantes | 16.4054 | 1.5394 | 0.963 |
| execute | clasicas | 1000000 | final_flags_none | default | 16.5466 | 1.4297 | 1.057 |
| execute | clasicas | 1000000 | normal | default | 16.3338 | 2.1254 | 0.967 |
| execute | clasicas | 1000000 | final_flags_none | filtros | 15.1713 | 2.2905 | 1.153 |
| execute | clasicas | 1000000 | normal | filtros | 15.6947 | 1.0696 | 1.006 |
| execute | clasicas | 1000000 | final_flags_none | joins | 17.3912 | 1.5083 | 1.006 |
| execute | clasicas | 1000000 | normal | joins | 16.3394 | 1.6967 | 0.967 |
| execute | clasicas | 1000000 | final_flags_none | manual | 15.7892 | 3.3148 | 1.108 |
| execute | clasicas | 1000000 | normal | manual | 16.7759 | 0.9474 | 0.942 |
| execute | clasicas | 1000000 | final_flags_none | muertos | 16.5387 | 0.8080 | 1.058 |
| execute | clasicas | 1000000 | normal | muertos | 16.4080 | 2.0048 | 0.963 |
| execute | clasicas | 1000000 | final_flags_none | rangos | 17.2543 | 1.9540 | 1.014 |
| execute | clasicas | 1000000 | normal | rangos | 16.8016 | 1.5265 | 0.940 |
| execute | clasicas | 200000 | final_flags_none | O0 | 3.6230 | 0.9106 | 1.000 |
| execute | clasicas | 200000 | normal | O0 | 3.7203 | 0.8212 | 1.000 |
| execute | clasicas | 200000 | final_flags_none | constantes | 3.4776 | 0.6109 | 1.042 |
| execute | clasicas | 200000 | normal | constantes | 3.4196 | 0.4670 | 1.088 |
| execute | clasicas | 200000 | final_flags_none | default | 3.1971 | 0.5558 | 1.133 |
| execute | clasicas | 200000 | normal | default | 3.4740 | 0.7685 | 1.071 |
| execute | clasicas | 200000 | final_flags_none | filtros | 3.5776 | 0.5507 | 1.013 |
| execute | clasicas | 200000 | normal | filtros | 3.5245 | 0.7219 | 1.056 |
| execute | clasicas | 200000 | final_flags_none | joins | 3.3517 | 0.7157 | 1.081 |
| execute | clasicas | 200000 | normal | joins | 3.4607 | 0.6555 | 1.075 |
| execute | clasicas | 200000 | final_flags_none | manual | 3.4322 | 0.8736 | 1.056 |
| execute | clasicas | 200000 | normal | manual | 3.4765 | 1.2701 | 1.070 |
| execute | clasicas | 200000 | final_flags_none | muertos | 3.6136 | 0.5763 | 1.003 |
| execute | clasicas | 200000 | normal | muertos | 3.5565 | 1.1182 | 1.046 |
| execute | clasicas | 200000 | final_flags_none | rangos | 3.8295 | 1.2322 | 0.946 |
| execute | clasicas | 200000 | normal | rangos | 3.4381 | 0.4083 | 1.082 |
| execute | combinado | 10000 | final_flags_none | O0 | 2.3849 | 1.5152 | 1.000 |
| execute | combinado | 10000 | normal | O0 | 2.0974 | 0.3437 | 1.000 |
| execute | combinado | 10000 | final_flags_none | constantes | 2.0254 | 0.4516 | 1.177 |
| execute | combinado | 10000 | normal | constantes | 2.3089 | 0.6706 | 0.908 |
| execute | combinado | 10000 | final_flags_none | default | 1.6810 | 0.6836 | 1.419 |
| execute | combinado | 10000 | normal | default | 1.7474 | 1.0182 | 1.200 |
| execute | combinado | 10000 | final_flags_none | filtros | 1.9245 | 1.0581 | 1.239 |
| execute | combinado | 10000 | normal | filtros | 2.1786 | 1.4491 | 0.963 |
| execute | combinado | 10000 | final_flags_none | joins | 1.8588 | 0.2773 | 1.283 |
| execute | combinado | 10000 | normal | joins | 1.6525 | 0.2427 | 1.269 |
| execute | combinado | 10000 | final_flags_none | manual | 1.8445 | 1.0285 | 1.293 |
| execute | combinado | 10000 | normal | manual | 2.4590 | 0.4338 | 0.853 |
| execute | combinado | 10000 | final_flags_none | muertos | 2.3219 | 0.3818 | 1.027 |
| execute | combinado | 10000 | normal | muertos | 2.2579 | 0.6124 | 0.929 |
| execute | combinado | 10000 | final_flags_none | rangos | 2.0861 | 0.1646 | 1.143 |
| execute | combinado | 10000 | normal | rangos | 2.2996 | 0.6499 | 0.912 |
| execute | combinado | 1000000 | final_flags_none | O0 | 18.9158 | 3.2219 | 1.000 |
| execute | combinado | 1000000 | normal | O0 | 13.1244 | 1.5899 | 1.000 |
| execute | combinado | 1000000 | final_flags_none | constantes | 19.3968 | 2.4735 | 0.975 |
| execute | combinado | 1000000 | normal | constantes | 13.8221 | 1.2581 | 0.950 |
| execute | combinado | 1000000 | final_flags_none | default | 8.4773 | 1.6127 | 2.231 |
| execute | combinado | 1000000 | normal | default | 8.7495 | 0.9066 | 1.500 |
| execute | combinado | 1000000 | final_flags_none | filtros | 18.3914 | 1.7147 | 1.029 |
| execute | combinado | 1000000 | normal | filtros | 13.7908 | 1.6268 | 0.952 |
| execute | combinado | 1000000 | final_flags_none | joins | 8.6491 | 0.7585 | 2.187 |
| execute | combinado | 1000000 | normal | joins | 8.7860 | 1.1119 | 1.494 |
| execute | combinado | 1000000 | final_flags_none | manual | 18.4112 | 1.2042 | 1.027 |
| execute | combinado | 1000000 | normal | manual | 13.7256 | 1.2790 | 0.956 |
| execute | combinado | 1000000 | final_flags_none | muertos | 19.2851 | 0.9087 | 0.981 |
| execute | combinado | 1000000 | normal | muertos | 13.0956 | 0.8361 | 1.002 |
| execute | combinado | 1000000 | final_flags_none | rangos | 20.0952 | 2.9596 | 0.941 |
| execute | combinado | 1000000 | normal | rangos | 13.1384 | 1.2914 | 0.999 |
| execute | combinado | 200000 | final_flags_none | O0 | 5.5170 | 0.5252 | 1.000 |
| execute | combinado | 200000 | normal | O0 | 4.9868 | 0.5054 | 1.000 |
| execute | combinado | 200000 | final_flags_none | constantes | 5.5956 | 0.4383 | 0.986 |
| execute | combinado | 200000 | normal | constantes | 4.3201 | 1.2062 | 1.154 |
| execute | combinado | 200000 | final_flags_none | default | 3.9020 | 0.4474 | 1.414 |
| execute | combinado | 200000 | normal | default | 4.1151 | 0.8868 | 1.212 |
| execute | combinado | 200000 | final_flags_none | filtros | 6.5611 | 1.0831 | 0.841 |
| execute | combinado | 200000 | normal | filtros | 4.5303 | 0.9393 | 1.101 |
| execute | combinado | 200000 | final_flags_none | joins | 3.8967 | 0.7774 | 1.416 |
| execute | combinado | 200000 | normal | joins | 3.6145 | 1.2964 | 1.380 |
| execute | combinado | 200000 | final_flags_none | manual | 5.6882 | 0.6563 | 0.970 |
| execute | combinado | 200000 | normal | manual | 4.8958 | 0.9136 | 1.019 |
| execute | combinado | 200000 | final_flags_none | muertos | 5.7350 | 1.3709 | 0.962 |
| execute | combinado | 200000 | normal | muertos | 4.9593 | 0.9282 | 1.006 |
| execute | combinado | 200000 | final_flags_none | rangos | 6.2100 | 1.3688 | 0.888 |
| execute | combinado | 200000 | normal | rangos | 4.7456 | 0.9953 | 1.051 |
| execute | control_join | 10000 | final_flags_none | O0 | 1.1177 | 0.8843 | 1.000 |
| execute | control_join | 10000 | normal | O0 | 1.0720 | 0.1062 | 1.000 |
| execute | control_join | 10000 | final_flags_none | constantes | 1.0059 | 0.2004 | 1.111 |
| execute | control_join | 10000 | normal | constantes | 1.1552 | 0.2032 | 0.928 |
| execute | control_join | 10000 | final_flags_none | default | 1.0479 | 0.4038 | 1.067 |
| execute | control_join | 10000 | normal | default | 1.1038 | 0.4027 | 0.971 |
| execute | control_join | 10000 | final_flags_none | filtros | 1.0861 | 0.1780 | 1.029 |
| execute | control_join | 10000 | normal | filtros | 1.0441 | 0.2567 | 1.027 |
| execute | control_join | 10000 | final_flags_none | joins | 1.1827 | 1.0198 | 0.945 |
| execute | control_join | 10000 | normal | joins | 1.4802 | 0.6572 | 0.724 |
| execute | control_join | 10000 | final_flags_none | manual | 1.0706 | 0.2558 | 1.044 |
| execute | control_join | 10000 | normal | manual | 1.0345 | 0.1272 | 1.036 |
| execute | control_join | 10000 | final_flags_none | muertos | 1.0674 | 0.6427 | 1.047 |
| execute | control_join | 10000 | normal | muertos | 1.2817 | 0.5832 | 0.836 |
| execute | control_join | 10000 | final_flags_none | rangos | 1.0260 | 0.6103 | 1.089 |
| execute | control_join | 10000 | normal | rangos | 1.4257 | 0.8740 | 0.752 |
| execute | control_join | 1000000 | final_flags_none | O0 | 17.8601 | 2.7112 | 1.000 |
| execute | control_join | 1000000 | normal | O0 | 16.2328 | 1.4793 | 1.000 |
| execute | control_join | 1000000 | final_flags_none | constantes | 17.2078 | 1.0656 | 1.038 |
| execute | control_join | 1000000 | normal | constantes | 15.5383 | 0.6983 | 1.045 |
| execute | control_join | 1000000 | final_flags_none | default | 17.3328 | 1.0168 | 1.030 |
| execute | control_join | 1000000 | normal | default | 15.7612 | 1.0344 | 1.030 |
| execute | control_join | 1000000 | final_flags_none | filtros | 18.4961 | 2.2932 | 0.966 |
| execute | control_join | 1000000 | normal | filtros | 15.8076 | 3.1174 | 1.027 |
| execute | control_join | 1000000 | final_flags_none | joins | 18.2873 | 0.9616 | 0.977 |
| execute | control_join | 1000000 | normal | joins | 15.1985 | 2.0569 | 1.068 |
| execute | control_join | 1000000 | final_flags_none | manual | 17.9124 | 3.1309 | 0.997 |
| execute | control_join | 1000000 | normal | manual | 15.2197 | 1.3988 | 1.067 |
| execute | control_join | 1000000 | final_flags_none | muertos | 18.1249 | 2.0629 | 0.985 |
| execute | control_join | 1000000 | normal | muertos | 15.2485 | 1.5651 | 1.065 |
| execute | control_join | 1000000 | final_flags_none | rangos | 17.3850 | 2.4280 | 1.027 |
| execute | control_join | 1000000 | normal | rangos | 15.1159 | 0.8347 | 1.074 |
| execute | control_join | 200000 | final_flags_none | O0 | 4.4467 | 0.7221 | 1.000 |
| execute | control_join | 200000 | normal | O0 | 4.0213 | 1.1670 | 1.000 |
| execute | control_join | 200000 | final_flags_none | constantes | 4.7378 | 0.5159 | 0.939 |
| execute | control_join | 200000 | normal | constantes | 4.0781 | 0.8404 | 0.986 |
| execute | control_join | 200000 | final_flags_none | default | 5.2370 | 1.4501 | 0.849 |
| execute | control_join | 200000 | normal | default | 4.0450 | 0.6844 | 0.994 |
| execute | control_join | 200000 | final_flags_none | filtros | 4.6865 | 1.0297 | 0.949 |
| execute | control_join | 200000 | normal | filtros | 3.9554 | 0.4722 | 1.017 |
| execute | control_join | 200000 | final_flags_none | joins | 4.5135 | 0.5054 | 0.985 |
| execute | control_join | 200000 | normal | joins | 3.9751 | 0.5066 | 1.012 |
| execute | control_join | 200000 | final_flags_none | manual | 4.7614 | 1.0547 | 0.934 |
| execute | control_join | 200000 | normal | manual | 4.2270 | 0.7719 | 0.951 |
| execute | control_join | 200000 | final_flags_none | muertos | 4.2856 | 1.7293 | 1.038 |
| execute | control_join | 200000 | normal | muertos | 3.9210 | 0.7358 | 1.026 |
| execute | control_join | 200000 | final_flags_none | rangos | 5.2514 | 1.6297 | 0.847 |
| execute | control_join | 200000 | normal | rangos | 3.9611 | 0.9133 | 1.015 |
| execute | control_limites | 10000 | final_flags_none | O0 | 0.6930 | 0.3448 | 1.000 |
| execute | control_limites | 10000 | normal | O0 | 0.6574 | 0.5189 | 1.000 |
| execute | control_limites | 10000 | final_flags_none | constantes | 0.7198 | 0.2446 | 0.963 |
| execute | control_limites | 10000 | normal | constantes | 0.7966 | 0.2297 | 0.825 |
| execute | control_limites | 10000 | final_flags_none | default | 0.4777 | 0.1758 | 1.451 |
| execute | control_limites | 10000 | normal | default | 0.5801 | 0.2207 | 1.133 |
| execute | control_limites | 10000 | final_flags_none | filtros | 0.7150 | 0.2093 | 0.969 |
| execute | control_limites | 10000 | normal | filtros | 0.6125 | 0.2114 | 1.073 |
| execute | control_limites | 10000 | final_flags_none | joins | 0.6231 | 0.4253 | 1.112 |
| execute | control_limites | 10000 | normal | joins | 0.8048 | 0.4851 | 0.817 |
| execute | control_limites | 10000 | final_flags_none | manual | 0.6181 | 0.4863 | 1.121 |
| execute | control_limites | 10000 | normal | manual | 0.7976 | 0.4771 | 0.824 |
| execute | control_limites | 10000 | final_flags_none | muertos | 0.7233 | 0.2007 | 0.958 |
| execute | control_limites | 10000 | normal | muertos | 0.5626 | 0.2515 | 1.169 |
| execute | control_limites | 10000 | final_flags_none | rangos | 0.6990 | 0.1962 | 0.991 |
| execute | control_limites | 10000 | normal | rangos | 0.5940 | 0.2319 | 1.107 |
| execute | control_limites | 1000000 | final_flags_none | O0 | 21.1829 | 3.0773 | 1.000 |
| execute | control_limites | 1000000 | normal | O0 | 20.8111 | 3.0886 | 1.000 |
| execute | control_limites | 1000000 | final_flags_none | constantes | 21.2072 | 2.3426 | 0.999 |
| execute | control_limites | 1000000 | normal | constantes | 20.8387 | 2.2574 | 0.999 |
| execute | control_limites | 1000000 | final_flags_none | default | 21.3275 | 1.6577 | 0.993 |
| execute | control_limites | 1000000 | normal | default | 21.8753 | 0.7691 | 0.951 |
| execute | control_limites | 1000000 | final_flags_none | filtros | 21.2783 | 2.3966 | 0.996 |
| execute | control_limites | 1000000 | normal | filtros | 21.1699 | 1.8884 | 0.983 |
| execute | control_limites | 1000000 | final_flags_none | joins | 21.1863 | 0.5288 | 1.000 |
| execute | control_limites | 1000000 | normal | joins | 20.2010 | 1.6511 | 1.030 |
| execute | control_limites | 1000000 | final_flags_none | manual | 19.9313 | 2.5480 | 1.063 |
| execute | control_limites | 1000000 | normal | manual | 21.2934 | 1.1094 | 0.977 |
| execute | control_limites | 1000000 | final_flags_none | muertos | 20.8658 | 1.1998 | 1.015 |
| execute | control_limites | 1000000 | normal | muertos | 21.3286 | 1.3148 | 0.976 |
| execute | control_limites | 1000000 | final_flags_none | rangos | 20.8778 | 1.9920 | 1.015 |
| execute | control_limites | 1000000 | normal | rangos | 21.0660 | 1.1974 | 0.988 |
| execute | control_limites | 200000 | final_flags_none | O0 | 3.6888 | 0.5442 | 1.000 |
| execute | control_limites | 200000 | normal | O0 | 3.6386 | 0.7161 | 1.000 |
| execute | control_limites | 200000 | final_flags_none | constantes | 4.2636 | 1.1841 | 0.865 |
| execute | control_limites | 200000 | normal | constantes | 3.6025 | 0.3654 | 1.010 |
| execute | control_limites | 200000 | final_flags_none | default | 3.6266 | 0.4029 | 1.017 |
| execute | control_limites | 200000 | normal | default | 3.6554 | 0.7900 | 0.995 |
| execute | control_limites | 200000 | final_flags_none | filtros | 3.3218 | 0.7248 | 1.110 |
| execute | control_limites | 200000 | normal | filtros | 3.8389 | 0.6115 | 0.948 |
| execute | control_limites | 200000 | final_flags_none | joins | 3.7679 | 0.4107 | 0.979 |
| execute | control_limites | 200000 | normal | joins | 4.5730 | 1.2641 | 0.796 |
| execute | control_limites | 200000 | final_flags_none | manual | 3.6457 | 0.5017 | 1.012 |
| execute | control_limites | 200000 | normal | manual | 3.7279 | 0.6417 | 0.976 |
| execute | control_limites | 200000 | final_flags_none | muertos | 3.8951 | 1.5983 | 0.947 |
| execute | control_limites | 200000 | normal | muertos | 4.0010 | 0.8737 | 0.909 |
| execute | control_limites | 200000 | final_flags_none | rangos | 3.6222 | 0.4881 | 1.018 |
| execute | control_limites | 200000 | normal | rangos | 3.5954 | 0.4751 | 1.012 |
| execute | control_sin_garantia | 10000 | final_flags_none | O0 | 0.9006 | 0.4767 | 1.000 |
| execute | control_sin_garantia | 10000 | normal | O0 | 1.1672 | 0.5906 | 1.000 |
| execute | control_sin_garantia | 10000 | final_flags_none | constantes | 1.1895 | 0.5380 | 0.757 |
| execute | control_sin_garantia | 10000 | normal | constantes | 0.9012 | 0.3880 | 1.295 |
| execute | control_sin_garantia | 10000 | final_flags_none | default | 0.9806 | 0.7023 | 0.918 |
| execute | control_sin_garantia | 10000 | normal | default | 1.7325 | 0.8922 | 0.674 |
| execute | control_sin_garantia | 10000 | final_flags_none | filtros | 1.0869 | 0.5436 | 0.829 |
| execute | control_sin_garantia | 10000 | normal | filtros | 1.3133 | 0.8952 | 0.889 |
| execute | control_sin_garantia | 10000 | final_flags_none | joins | 0.9569 | 0.3874 | 0.941 |
| execute | control_sin_garantia | 10000 | normal | joins | 1.1028 | 0.2556 | 1.058 |
| execute | control_sin_garantia | 10000 | final_flags_none | manual | 0.9292 | 0.4202 | 0.969 |
| execute | control_sin_garantia | 10000 | normal | manual | 0.9188 | 0.1808 | 1.270 |
| execute | control_sin_garantia | 10000 | final_flags_none | muertos | 0.8075 | 0.2810 | 1.115 |
| execute | control_sin_garantia | 10000 | normal | muertos | 1.2272 | 0.5208 | 0.951 |
| execute | control_sin_garantia | 10000 | final_flags_none | rangos | 0.9998 | 0.1780 | 0.901 |
| execute | control_sin_garantia | 10000 | normal | rangos | 0.8886 | 0.7943 | 1.314 |
| execute | control_sin_garantia | 1000000 | final_flags_none | O0 | 5.3491 | 1.2826 | 1.000 |
| execute | control_sin_garantia | 1000000 | normal | O0 | 3.5081 | 0.2426 | 1.000 |
| execute | control_sin_garantia | 1000000 | final_flags_none | constantes | 5.1388 | 0.5771 | 1.041 |
| execute | control_sin_garantia | 1000000 | normal | constantes | 3.5152 | 0.7114 | 0.998 |
| execute | control_sin_garantia | 1000000 | final_flags_none | default | 5.5366 | 1.3231 | 0.966 |
| execute | control_sin_garantia | 1000000 | normal | default | 3.4795 | 1.1039 | 1.008 |
| execute | control_sin_garantia | 1000000 | final_flags_none | filtros | 4.6100 | 0.5151 | 1.160 |
| execute | control_sin_garantia | 1000000 | normal | filtros | 4.0617 | 0.7431 | 0.864 |
| execute | control_sin_garantia | 1000000 | final_flags_none | joins | 5.0697 | 1.2196 | 1.055 |
| execute | control_sin_garantia | 1000000 | normal | joins | 3.6053 | 0.3318 | 0.973 |
| execute | control_sin_garantia | 1000000 | final_flags_none | manual | 5.2916 | 0.7578 | 1.011 |
| execute | control_sin_garantia | 1000000 | normal | manual | 3.7154 | 0.8799 | 0.944 |
| execute | control_sin_garantia | 1000000 | final_flags_none | muertos | 5.4064 | 1.0770 | 0.989 |
| execute | control_sin_garantia | 1000000 | normal | muertos | 3.8939 | 0.4354 | 0.901 |
| execute | control_sin_garantia | 1000000 | final_flags_none | rangos | 5.2025 | 1.3443 | 1.028 |
| execute | control_sin_garantia | 1000000 | normal | rangos | 3.9229 | 1.0031 | 0.894 |
| execute | control_sin_garantia | 200000 | final_flags_none | O0 | 2.1599 | 0.7435 | 1.000 |
| execute | control_sin_garantia | 200000 | normal | O0 | 1.8600 | 0.6806 | 1.000 |
| execute | control_sin_garantia | 200000 | final_flags_none | constantes | 2.1431 | 0.2655 | 1.008 |
| execute | control_sin_garantia | 200000 | normal | constantes | 1.6110 | 0.3890 | 1.155 |
| execute | control_sin_garantia | 200000 | final_flags_none | default | 2.1112 | 0.6772 | 1.023 |
| execute | control_sin_garantia | 200000 | normal | default | 1.5825 | 0.8597 | 1.175 |
| execute | control_sin_garantia | 200000 | final_flags_none | filtros | 2.1405 | 0.3528 | 1.009 |
| execute | control_sin_garantia | 200000 | normal | filtros | 1.8214 | 0.9896 | 1.021 |
| execute | control_sin_garantia | 200000 | final_flags_none | joins | 1.8060 | 0.3364 | 1.196 |
| execute | control_sin_garantia | 200000 | normal | joins | 1.7295 | 0.5653 | 1.075 |
| execute | control_sin_garantia | 200000 | final_flags_none | manual | 1.9200 | 0.8625 | 1.125 |
| execute | control_sin_garantia | 200000 | normal | manual | 1.8395 | 1.0470 | 1.011 |
| execute | control_sin_garantia | 200000 | final_flags_none | muertos | 2.3446 | 0.8875 | 0.921 |
| execute | control_sin_garantia | 200000 | normal | muertos | 1.9616 | 0.5661 | 0.948 |
| execute | control_sin_garantia | 200000 | final_flags_none | rangos | 1.8511 | 1.2304 | 1.167 |
| execute | control_sin_garantia | 200000 | normal | rangos | 1.7370 | 0.3453 | 1.071 |
| execute | join | 10000 | final_flags_none | O0 | 1.2476 | 0.6283 | 1.000 |
| execute | join | 10000 | normal | O0 | 1.0622 | 0.2295 | 1.000 |
| execute | join | 10000 | final_flags_none | constantes | 1.3079 | 0.3267 | 0.954 |
| execute | join | 10000 | normal | constantes | 1.1790 | 0.8669 | 0.901 |
| execute | join | 10000 | final_flags_none | default | 0.6975 | 0.1732 | 1.789 |
| execute | join | 10000 | normal | default | 0.7188 | 0.2040 | 1.478 |
| execute | join | 10000 | final_flags_none | filtros | 0.9996 | 0.1151 | 1.248 |
| execute | join | 10000 | normal | filtros | 1.1778 | 0.7394 | 0.902 |
| execute | join | 10000 | final_flags_none | joins | 0.8202 | 0.2247 | 1.521 |
| execute | join | 10000 | normal | joins | 0.7625 | 0.2181 | 1.393 |
| execute | join | 10000 | final_flags_none | manual | 1.1494 | 0.6044 | 1.085 |
| execute | join | 10000 | normal | manual | 0.9956 | 0.6382 | 1.067 |
| execute | join | 10000 | final_flags_none | muertos | 1.1861 | 0.4426 | 1.052 |
| execute | join | 10000 | normal | muertos | 1.1486 | 0.2158 | 0.925 |
| execute | join | 10000 | final_flags_none | rangos | 1.0466 | 0.3810 | 1.192 |
| execute | join | 10000 | normal | rangos | 0.8923 | 0.0800 | 1.190 |
| execute | join | 1000000 | final_flags_none | O0 | 16.4170 | 2.1088 | 1.000 |
| execute | join | 1000000 | normal | O0 | 11.4485 | 0.7292 | 1.000 |
| execute | join | 1000000 | final_flags_none | constantes | 16.2041 | 1.2095 | 1.013 |
| execute | join | 1000000 | normal | constantes | 12.1566 | 0.8381 | 0.942 |
| execute | join | 1000000 | final_flags_none | default | 2.4185 | 0.4374 | 6.788 |
| execute | join | 1000000 | normal | default | 2.6018 | 0.8249 | 4.400 |
| execute | join | 1000000 | final_flags_none | filtros | 16.5754 | 0.9935 | 0.990 |
| execute | join | 1000000 | normal | filtros | 12.6262 | 1.5689 | 0.907 |
| execute | join | 1000000 | final_flags_none | joins | 2.5358 | 0.5296 | 6.474 |
| execute | join | 1000000 | normal | joins | 2.2660 | 0.3824 | 5.052 |
| execute | join | 1000000 | final_flags_none | manual | 17.2019 | 1.2279 | 0.954 |
| execute | join | 1000000 | normal | manual | 12.2013 | 1.6387 | 0.938 |
| execute | join | 1000000 | final_flags_none | muertos | 17.0902 | 2.1572 | 0.961 |
| execute | join | 1000000 | normal | muertos | 12.5552 | 1.1738 | 0.912 |
| execute | join | 1000000 | final_flags_none | rangos | 16.7470 | 0.9463 | 0.980 |
| execute | join | 1000000 | normal | rangos | 12.9144 | 1.5880 | 0.886 |
| execute | join | 200000 | final_flags_none | O0 | 4.8718 | 0.9210 | 1.000 |
| execute | join | 200000 | normal | O0 | 3.4557 | 1.4284 | 1.000 |
| execute | join | 200000 | final_flags_none | constantes | 4.3153 | 1.1714 | 1.129 |
| execute | join | 200000 | normal | constantes | 3.7631 | 1.0437 | 0.918 |
| execute | join | 200000 | final_flags_none | default | 1.6498 | 0.7937 | 2.953 |
| execute | join | 200000 | normal | default | 1.5175 | 0.3241 | 2.277 |
| execute | join | 200000 | final_flags_none | filtros | 4.2275 | 0.8551 | 1.152 |
| execute | join | 200000 | normal | filtros | 3.4230 | 0.4513 | 1.010 |
| execute | join | 200000 | final_flags_none | joins | 1.4309 | 0.4959 | 3.405 |
| execute | join | 200000 | normal | joins | 1.2692 | 0.2378 | 2.723 |
| execute | join | 200000 | final_flags_none | manual | 4.5554 | 1.7447 | 1.069 |
| execute | join | 200000 | normal | manual | 3.9572 | 1.2039 | 0.873 |
| execute | join | 200000 | final_flags_none | muertos | 4.5918 | 1.3517 | 1.061 |
| execute | join | 200000 | normal | muertos | 3.2814 | 0.4629 | 1.053 |
| execute | join | 200000 | final_flags_none | rangos | 4.8779 | 0.9711 | 0.999 |
| execute | join | 200000 | normal | rangos | 3.4343 | 0.7959 | 1.006 |
| execute | rangos | 10000 | final_flags_none | O0 | 0.5309 | 0.0925 | 1.000 |
| execute | rangos | 10000 | normal | O0 | 0.4975 | 0.3246 | 1.000 |
| execute | rangos | 10000 | final_flags_none | constantes | 0.5545 | 0.1695 | 0.957 |
| execute | rangos | 10000 | normal | constantes | 0.6293 | 0.3038 | 0.791 |
| execute | rangos | 10000 | final_flags_none | default | 0.5357 | 0.1208 | 0.991 |
| execute | rangos | 10000 | normal | default | 0.5682 | 0.1345 | 0.876 |
| execute | rangos | 10000 | final_flags_none | filtros | 0.5377 | 0.0880 | 0.987 |
| execute | rangos | 10000 | normal | filtros | 0.5374 | 0.0719 | 0.926 |
| execute | rangos | 10000 | final_flags_none | joins | 0.5349 | 0.3861 | 0.992 |
| execute | rangos | 10000 | normal | joins | 0.6757 | 0.5931 | 0.736 |
| execute | rangos | 10000 | final_flags_none | manual | 0.4992 | 0.0482 | 1.063 |
| execute | rangos | 10000 | normal | manual | 0.5397 | 0.1884 | 0.922 |
| execute | rangos | 10000 | final_flags_none | muertos | 0.5450 | 0.1689 | 0.974 |
| execute | rangos | 10000 | normal | muertos | 0.5620 | 0.1416 | 0.885 |
| execute | rangos | 10000 | final_flags_none | rangos | 0.4487 | 0.0310 | 1.183 |
| execute | rangos | 10000 | normal | rangos | 0.5827 | 0.3293 | 0.854 |
| execute | rangos | 1000000 | final_flags_none | O0 | 13.0226 | 0.3695 | 1.000 |
| execute | rangos | 1000000 | normal | O0 | 12.4385 | 0.4826 | 1.000 |
| execute | rangos | 1000000 | final_flags_none | constantes | 13.3673 | 0.7572 | 0.974 |
| execute | rangos | 1000000 | normal | constantes | 12.5626 | 0.4281 | 0.990 |
| execute | rangos | 1000000 | final_flags_none | default | 12.4359 | 0.7754 | 1.047 |
| execute | rangos | 1000000 | normal | default | 12.6280 | 0.5622 | 0.985 |
| execute | rangos | 1000000 | final_flags_none | filtros | 13.0647 | 1.2528 | 0.997 |
| execute | rangos | 1000000 | normal | filtros | 12.4678 | 0.5007 | 0.998 |
| execute | rangos | 1000000 | final_flags_none | joins | 13.1839 | 2.1769 | 0.988 |
| execute | rangos | 1000000 | normal | joins | 11.9394 | 0.6408 | 1.042 |
| execute | rangos | 1000000 | final_flags_none | manual | 12.0727 | 0.2810 | 1.079 |
| execute | rangos | 1000000 | normal | manual | 12.4837 | 0.2974 | 0.996 |
| execute | rangos | 1000000 | final_flags_none | muertos | 12.9530 | 0.3262 | 1.005 |
| execute | rangos | 1000000 | normal | muertos | 12.4740 | 0.6599 | 0.997 |
| execute | rangos | 1000000 | final_flags_none | rangos | 12.7143 | 0.5291 | 1.024 |
| execute | rangos | 1000000 | normal | rangos | 12.1560 | 1.2670 | 1.023 |
| execute | rangos | 200000 | final_flags_none | O0 | 2.9467 | 0.7339 | 1.000 |
| execute | rangos | 200000 | normal | O0 | 2.6942 | 0.2004 | 1.000 |
| execute | rangos | 200000 | final_flags_none | constantes | 2.7990 | 0.4300 | 1.053 |
| execute | rangos | 200000 | normal | constantes | 2.6484 | 0.1191 | 1.017 |
| execute | rangos | 200000 | final_flags_none | default | 2.7053 | 0.3717 | 1.089 |
| execute | rangos | 200000 | normal | default | 2.7679 | 0.5235 | 0.973 |
| execute | rangos | 200000 | final_flags_none | filtros | 2.6566 | 0.1777 | 1.109 |
| execute | rangos | 200000 | normal | filtros | 3.4271 | 0.7378 | 0.786 |
| execute | rangos | 200000 | final_flags_none | joins | 3.0465 | 0.2979 | 0.967 |
| execute | rangos | 200000 | normal | joins | 2.7639 | 0.7066 | 0.975 |
| execute | rangos | 200000 | final_flags_none | manual | 2.6517 | 1.1170 | 1.111 |
| execute | rangos | 200000 | normal | manual | 2.7839 | 0.7458 | 0.968 |
| execute | rangos | 200000 | final_flags_none | muertos | 2.9259 | 0.8439 | 1.007 |
| execute | rangos | 200000 | normal | muertos | 2.8212 | 0.6158 | 0.955 |
| execute | rangos | 200000 | final_flags_none | rangos | 2.9147 | 1.0406 | 1.011 |
| execute | rangos | 200000 | normal | rangos | 2.8812 | 0.2162 | 0.935 |

## Evidencia estructural (fuera del tiempo)

`changed` compara nodos/payload/enlaces; añadir hechos a la IR no cuenta como reescritura. rangos y joins conservan sus pruebas completas en structure.json. Los otros pases muestran nodos eliminados/modificados/fusionados; las abstenciones se comprueban al ejecutar el arnés.

| Workload | Configuración | Nodos antes/después | Cambia | Pruebas rangos/joins |
|---|---|---:|---|---:|
| rangos | O0 | 7/7 | False | 0/0 |
| rangos | constantes | 7/7 | False | 0/0 |
| rangos | rangos | 7/6 | True | 2/0 |
| rangos | filtros | 7/6 | True | 0/0 |
| rangos | joins | 7/7 | False | 0/0 |
| rangos | muertos | 7/7 | False | 0/0 |
| rangos | default | 7/6 | True | 2/0 |
| clasicas | O0 | 8/8 | False | 0/0 |
| clasicas | constantes | 8/7 | True | 0/0 |
| clasicas | rangos | 8/8 | False | 0/0 |
| clasicas | filtros | 8/6 | True | 0/0 |
| clasicas | joins | 8/8 | False | 0/0 |
| clasicas | muertos | 8/7 | True | 0/0 |
| clasicas | default | 8/5 | True | 0/0 |
| join | O0 | 5/5 | False | 0/0 |
| join | constantes | 5/5 | False | 0/0 |
| join | rangos | 5/5 | False | 0/0 |
| join | filtros | 5/5 | False | 0/0 |
| join | joins | 5/5 | True | 0/1 |
| join | muertos | 5/5 | False | 0/0 |
| join | default | 5/5 | True | 0/1 |
| combinado | O0 | 14/14 | False | 0/0 |
| combinado | constantes | 14/13 | True | 0/0 |
| combinado | rangos | 14/13 | True | 1/0 |
| combinado | filtros | 14/11 | True | 0/0 |
| combinado | joins | 14/14 | True | 0/1 |
| combinado | muertos | 14/13 | True | 0/0 |
| combinado | default | 14/10 | True | 1/1 |
| control_limites | O0 | 5/5 | False | 0/0 |
| control_limites | constantes | 5/5 | False | 0/0 |
| control_limites | rangos | 5/5 | False | 0/0 |
| control_limites | filtros | 5/4 | True | 0/0 |
| control_limites | joins | 5/5 | False | 0/0 |
| control_limites | muertos | 5/5 | False | 0/0 |
| control_limites | default | 5/4 | True | 0/0 |
| control_join | O0 | 5/5 | False | 0/0 |
| control_join | constantes | 5/5 | False | 0/0 |
| control_join | rangos | 5/5 | False | 0/0 |
| control_join | filtros | 5/5 | False | 0/0 |
| control_join | joins | 5/5 | False | 0/0 |
| control_join | muertos | 5/5 | False | 0/0 |
| control_join | default | 5/5 | False | 0/0 |
| control_sin_garantia | O0 | 5/5 | False | 0/0 |
| control_sin_garantia | constantes | 5/5 | False | 0/0 |
| control_sin_garantia | rangos | 5/5 | False | 0/0 |
| control_sin_garantia | filtros | 5/5 | False | 0/0 |
| control_sin_garantia | joins | 5/5 | False | 0/0 |
| control_sin_garantia | muertos | 5/5 | False | 0/0 |
| control_sin_garantia | default | 5/5 | False | 0/0 |
| agregados | O0 | 5/5 | False | 0/0 |
| agregados | constantes | 5/5 | False | 0/0 |
| agregados | rangos | 5/5 | False | 0/0 |
| agregados | filtros | 5/5 | False | 0/0 |
| agregados | joins | 5/5 | False | 0/0 |
| agregados | muertos | 5/5 | False | 0/0 |
| agregados | default | 5/5 | False | 0/0 |

## Expresividad y errores

LOC = líneas no vacías y no comentadas en los archivos reales, sin normalizar formato. La función Polars utiliza helpers compartidos y contratos del runtime: se indica su coste común por separado; las declaraciones de esquemas están en baselines.py. No se infiere legibilidad ni usabilidad a partir de LOC. El número de nodos cuenta construcciones de la IR original.

| Workload | LOC DSL | LOC función Polars | LOC helpers compartidos | Nodos |
|---|---:|---:|---:|---:|
| rangos | 10 | 4 | 11 | 7 |
| clasicas | 12 | 5 | 11 | 8 |
| join | 8 | 6 | 11 | 5 |
| combinado | 19 | 13 | 11 | 14 |
| control_limites | 8 | 4 | 11 | 5 |
| control_join | 8 | 6 | 11 | 5 |
| control_sin_garantia | 8 | 5 | 11 | 5 |
| agregados | 10 | 7 | 11 | 5 |

errors.csv contiene el corpus estático (columna ausente, predicado numérico y claves con tipos incompatibles) y sus controles Polars reales, que fallan al materializar. El corpus dinámico exige errores de claves, unicidad, referencia y contratos de ambas entradas a O0, a cada pase, al conjunto y al baseline contractual. No se cronometran fallos.

## Límites y reproducción

No se mide IO, memoria pico, arranque de intérprete, otras máquinas ni significancia. Se reutilizan buffers residentes pero se reconstruyen planes y resultados en cada invocación. No se vacían cachés CPU/SO; GC y planificación del sistema siguen activos. Ocho workloads sintéticos y una semilla no representan todos los ETL. Las optimizaciones habituales del motor pueden absorber el efecto de los pases; reducir nodos no garantiza reducir tiempo. El baseline comparte la implementación de contratos y puede compartir sus defectos: la suite del runtime aporta regresiones independientes. Los grupos suman valores enteros representados como Float64 para evitar ambigüedad por redondeo paralelo; no se evalúa toda aritmética decimal.

Comando equivalente desde la raíz (requiere requirements.txt; elegir un directorio nuevo):

```sh
.venv/bin/python -m benchmarks --mode measure --sizes 10000,200000,1000000 --seed 20261111 --threads 4 --warmups 2 --repetitions 10 --scenarios normal,final_flags_none --output benchmarks/results/reproduccion
```

samples.csv permite recalcular los resúmenes. summary.csv, structure.csv/json, errors.csv y metadata.json permiten auditar la campaña; estos artefactos generados no se versionan.
