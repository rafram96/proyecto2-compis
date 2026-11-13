# Benchmarks

Compara el código que genera el DSL con las mismas tareas escritas a mano en Polars,
Pandas y SQL de DuckDB, y mide el efecto de cada pase de optimización. Los datos son
TPC-H, generados con DuckDB.

## Correr todo

Un solo comando genera los datos, verifica que todas las variantes den el mismo
resultado, mide y deja un zip con los resultados.

**Con Docker (recomendado)**, desde la raíz del repositorio:

```bash
docker compose build bench
docker compose run --rm bench python bench/todo.py --borrar-datos
```

En Docker Desktop, darle al menos 16 GB de memoria (Settings › Resources): con 8 GB,
Pandas se queda sin memoria en SF 10.

**Sin Docker** (Python 3.12, Linux o macOS para medir la memoria; en Windows esa
columna queda vacía):

```bash
python -m venv .venv
source .venv/bin/activate                # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r bench/requirements.txt
python bench/todo.py --borrar-datos
```

Al terminar imprime la ruta del zip, por ejemplo
`bench/resultados/2026-11-14_10-30_equipo.zip`. Ese archivo es el que se guarda.

## Qué hace y cuánto ocupa

1. `datos.py` genera TPC-H en SF 0.1, 1, 5 y 10 (Parquet y CSV) en `bench/datos/`.
   Ocupa unos 20 GB y tarda unos 10 minutos. La extensión `tpch` de DuckDB se descarga
   la primera vez si no se usa Docker.
2. `verificar.py` corre cada variante en SF 0.1 y compara sus salidas. Si alguna
   difiere, no se mide nada.
3. `run.py` mide 5 tareas × 11 configuraciones × (1 calentamiento + 10 repeticiones)
   por escala. En un portátil de 16 hilos la corrida completa tomaría entre 2 y 3 horas.
4. Se crea el zip. Con `--borrar-datos` se borra `bench/datos/` al final.

Durante las mediciones conviene no usar el equipo para otra cosa y, si es un portátil,
tenerlo enchufado.

Opciones útiles (las que `todo.py` no reconoce pasan a `run.py`):

```bash
python bench/todo.py --sf 1 5 10 20            # otras escalas
python bench/todo.py --grupo rendimiento       # solo DSL, Polars, Pandas y DuckDB
python bench/todo.py --repeticiones 3          # prueba rápida
python bench/todo.py --limite 1800             # segundos máximos por medición
```

## Contenido del zip

| Archivo | Contenido |
|---|---|
| `tiempos.csv` | Una fila por medición: escala, tarea, configuración, repetición, estado (`ok`, `sin_memoria`, `tiempo_agotado`, `error`), segundos, compilación y memoria pico |
| `entorno.json` | CPU, hilos, memoria, versiones de Python y bibliotecas, parámetros y tamaño de los datos |
| `verificacion.txt` | Resultado de la verificación de equivalencia |
| `log.txt` | Salida completa de las mediciones |

## Tareas

Cada carpeta de `tareas/` tiene la misma tarea cuatro veces: `programa.etl`,
`polars_manual.py`, `pandas_manual.py` y `consulta.sql`.

| Tarea | Basada en | Qué ejercita |
|---|---|---|
| `resumen_precios` | Consulta 1 de TPC-H | `DERIVE`, `AGGREGATE` con 8 agregados, `SORT` |
| `ingreso_descuento` | Consulta 6 de TPC-H | Tres `FILTER` seguidos y constantes (pases `constantes` y `filtros`) |
| `ingreso_por_pedido` | Consulta 3 de TPC-H | Dos `JOIN` con lineitem, forma de grafo |
| `limpieza_pedidos` | `orders` con nulos y duplicados | `DROP_NULLS`, `FILL_NULL`, `DISTINCT` |
| `devoluciones` | — | Dos salidas `TO` de la misma cadena |

El DSL no tiene literales de fecha, así que las consultas de TPC-H se usan sin sus
filtros de fecha.

## Configuraciones

| Configuración | Qué es |
|---|---|
| `dsl` | Programa del DSL con todos los pases |
| `polars`, `pandas`, `duckdb` | Versiones escritas a mano |
| `dsl-O0` | DSL sin pases |
| `dsl-constantes`, `dsl-filtros`, `dsl-codigo_muerto` | Un solo pase |
| `dsl-sin-opt-polars`, `dsl-O0-sin-opt-polars`, `polars-sin-opt-polars` | Con el optimizador de Polars apagado, para aislar el efecto de los pases del DSL |
