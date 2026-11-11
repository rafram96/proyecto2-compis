# Backend Python + Polars

## Compilación y ejecución

```text
.etl -> Lark -> AST -> validación -> IR -> semántica estática -> pases -> Python con Polars (LazyFrame) -> SINK
```

## IR y optimización

`ir.lower` baja el AST validado a un DAG por pipeline: un nodo por declaración
(`SOURCE`, `INPUT`, `USE`, cada `STEP`, `SINK`, `OUTPUT`) con sus entradas
resueltas desde `FLOW` y en orden topológico. Las expresiones se reutilizan del
AST. `--format ir` imprime la IR antes y después de los pases:

```text
pipeline optimizaciones (raíz) {
  %ventas    = SOURCE { CSV(file: "../input/orders.csv") : TABLE }
  %pagadas   = FILTER(%ventas) { (amount < 1000) AND (status IS NOT NULL) }  // grandes + pagadas
  %ordenadas = SORT(%pagadas) { amount DESC }
  %resultado = SINK(%ordenadas) { CSV(file: "../output/optimizaciones.csv") }
}
```

| Pase | Qué hace |
| --- | --- |
| `constantes` | Pliega `+ - *` y comparaciones entre literales; simplifica `AND`, `OR` y `NOT` con `TRUE`/`FALSE` respetando la lógica de tres valores. Un `FILTER` que queda en `TRUE` se elimina. La división no se pliega. |
| `rangos` | Elimina filtros o términos AND implicados por intervalos y ausencia de NULL; registra hechos y pruebas en la IR. |
| `filtros` | Fusiona un `FILTER` con el `FILTER` anterior cuando este no tiene otros consumidores. |
| `muertos` | Elimina pasos cuyo resultado no llega a ningún `SINK`, `OUTPUT` ni `USE`. Los `INPUT` se conservan porque son la interfaz del pipeline. |

Todos se aplican por defecto. `-O0` los desactiva y `--pases a,b` elige cuáles y
en qué orden. Las pruebas comprueban que los resultados con y sin pases son
iguales. Un nodo fusionado conserva en `origin` las declaraciones que representa,
y sus errores de ejecución citan ambas (`grandes+pagadas`).

`python main.py` compila los programas de `input/` a `output/*.py`. La generación
de código valida nombres de conectores y sus opciones, ordena las declaraciones
topológicamente según `FLOW` y emite una función Python por pipeline. Los datos
no se consultan durante esta fase. C2 detecta incompatibilidades demostrables de
columnas y tipos antes de optimizar; archivos, nulos reales y conocimiento
desconocido conservan sus chequeos en ejecución.

Cada paso genera un `LazyFrame` nuevo a partir de su entrada, envuelto en
`rt.step(plan, etiqueta)`. `rt.step` resuelve el esquema del plan con
`collect_schema()` sin leer datos, por lo que columnas inexistentes o tipos
incompatibles se detectan en el paso que los causa. Nada se calcula hasta que un
`SINK` o un contrato con columnas no anulables necesita los datos; Polars
optimiza el plan completo en ese momento.

```python
t_2 = rt.step(t_1.filter((pl.col('monto') > pl.lit(0))), 'positivas (3:5)')
```

`python main.py --run` compila y ejecuta. Cada instancia `USE` invoca la función
del pipeline correspondiente y enlaza sus puertos lógicos.

Por defecto se ejecutan los pipelines que no son referenciados por `USE` y no
tienen `INPUT`. `--pipeline nombre` permite seleccionar pipelines explícitamente;
se puede repetir. Los programas sin raíces ejecutables requieren invocación
desde Python con sus entradas enlazadas. El código generado depende del runtime
del paquete instalado, pero no vuelve a leer ni interpretar el archivo `.etl`.

Los caminos relativos de conectores usan como base la carpeta del `.etl`.
El código generado conserva esa ruta absoluta por defecto y permite cambiarla
al ejecutarse con `--base-dir`. `--output` cambia dónde se guarda el código, sin
alterar dónde escriben los `SINK`.

```powershell
.\.venv\Scripts\python.exe scripts\create_demo_data.py
.\.venv\Scripts\python.exe main.py --run
.\.venv\Scripts\python.exe output\credit_risk.py --pipeline order_report
```

Con Docker: `docker compose run --rm etl` genera los datos de ejemplo y ejecuta
todos los pipelines; `docker compose run --rm tests` corre las pruebas.

## Conectores

Todas las opciones son literales. Las rutas, tablas, esquemas, delimitadores y
marcadores de nulos son cadenas; `header` es booleano. Los parámetros que no se
indican como opcionales son obligatorios.

| Conector | SOURCE | SINK | Opciones |
| --- | --- | --- | --- |
| `CSV` | Sí | Sí | `file`; `header` (TRUE), `delimiter` (","), `nullstr` ("") opcionales |
| `PARQUET` | Sí | Sí | `file` |
| `DUCKDB` | Sí | Sí | `file`, `table`, `schema` opcional (por defecto `main`); `mode` solo para SINK |
| `SQLITE` | Sí | No | `file`, `table` |

CSV y Parquet se leen de forma diferida con `pl.scan_csv` y `pl.scan_parquet`.
CSV infiere tipos con las primeras 10 000 filas. Con `nullstr` vacío, un campo
ausente se lee como `NULL` y un `""` entrecomillado conserva el texto vacío; con
otro `nullstr`, los campos iguales a ese valor se leen como `NULL`.

Los `SOURCE` requieren archivos locales existentes; no se aceptan patrones glob
ni URLs. Una opción `table: "schema.tabla"` se interpreta como un solo nombre:
para DuckDB se debe usar `schema: "schema", table: "tabla"`.

DuckDB y SQLite solo se usan como conectores: se leen completos con `fetchall`
y se convierten a un `DataFrame` de Polars según un mapa de tipos, sin pyarrow.
El paquete `duckdb` se importa solo si el programa usa el conector `DUCKDB`.
SQLite usa la biblioteca estándar `sqlite3` en solo lectura; las afinidades
enteras se mapean a `Int64`, las textuales a `String`, BLOB a `Binary`,
REAL/NUMERIC/DECIMAL a `Float64` y BOOL/DATE/DATETIME a sus tipos
correspondientes. Las declaraciones restantes usan `String`. DuckDB conserva
`DECIMAL(p,s)` como `pl.Decimal(p, s)`.

Los SINK CSV/Parquet crean las carpetas necesarias y reemplazan el archivo de
salida si ya existe. Un SINK DuckDB tiene `mode: "error"` por defecto (rechaza
una tabla ya existente). `mode: "replace"` la reemplaza; `mode: "append"` agrega
filas a una tabla que debe existir y enlaza las columnas por nombre.

## Semántica SQL sobre Polars

El DSL mantiene la semántica de nulos de SQL aunque Polars tenga otros valores
por defecto:

| DSL | Código generado | Motivo |
| --- | --- | --- |
| `SUM(x)` | `pl.when(x.count() > 0).then(x.sum())` | En Polars la suma de solo nulos es 0; en SQL es `NULL` |
| `COUNT()` | `pl.len().cast(pl.Int64)` | Cuenta filas, incluidas las nulas |
| `JOIN` | `join(..., coalesce=False)` | Conserva las claves de ambos lados; las claves nulas no coinciden |
| `SORT` | `sort(..., nulls_last=True, maintain_order=True)` | Nulos al final y orden estable |
| `AGGREGATE` | `group_by(..., maintain_order=True)` | Grupos en orden de aparición |
| `TRIM(s)` | `s.str.strip_chars(' ')` | Quita solo espacios, como SQL |
| `NULLIF(a, b)` | `pl.when(a == b).then(None).otherwise(a)` | |
| `SAFE_DIVIDE(a, b)` | `pl.when(b != 0).then(a / b)` | `NULL` cuando `b` es 0 |
| `FILL_NULL` | `pl.coalesce(columna, valor)` | |
| Literal `0.1` | `pl.lit(Decimal('0.1'))` | Precisión exacta, sin pasar por float |

`FILTER` conserva solo las filas cuya condición es `TRUE`. `FILL_NULL` reemplaza
solo columnas existentes; `DERIVE` debe crear columnas nuevas. Las referencias de
todas las asignaciones se validan contra la entrada original, para evitar
dependencias laterales entre aliases.

## Contratos

Los contratos `SOURCE`, `INPUT` y `OUTPUT` tipados verifican las mismas columnas
en el mismo orden, la familia de tipos y los nulos reales. No convierten los
datos. `INT` acepta enteros de Polars; `DECIMAL` es una familia numérica que
admite enteros, decimales y reales; `STRING` corresponde a `String`, `BOOL` a
`Boolean`, `DATE` a `Date` y `DATETIME` a `Datetime`. Las columnas sin `?` se
verifican con `null_count()`.

Se rechazan columnas de salida que difieran solo en mayúsculas (`E_AMBIGUOUS_COLUMNS`),
para que los resultados puedan escribirse también en DuckDB. Los errores llevan
códigos (`E_COLUMN`, `E_SCHEMA`, `E_TYPE`, `E_NULL`, `E_SOURCE`, `E_POLARS`…) y la
etiqueta del bloque con su ubicación en el `.etl`.

## API Python para puertos externos

Un módulo generado expone `PIPELINES` (funciones por nombre) y
`DEFAULT_PIPELINES` (raíces ejecutables). Una función recibe un `PolarsRuntime`
y un diccionario que enlaza cada INPUT con un `DataFrame` o `LazyFrame` de
Polars. Retorna un diccionario con los `LazyFrame` de los OUTPUT y SINK.

```python
import runpy
import polars as pl
from etl_dsl.runtime import PolarsRuntime

module = runpy.run_path("output/credit_risk.py")
rt = PolarsRuntime(base_dir="input")
orders = pl.DataFrame({"id": [1], "customer_id": [2], "amount": [None], "status": [None]},
                      schema={"id": pl.Int64, "customer_id": pl.Int64,
                              "amount": pl.Float64, "status": pl.String})
outputs = module["PIPELINES"]["clean_orders"](rt, {"orders": orders})
print(outputs["cleaned"].collect())
```

## Límites actuales

La verificación estática C2 está implementada; sus reglas y límites se describen
en [semantica_estatica.md](semantica_estatica.md). O1 (`rangos`) está implementado
con las restricciones de [optimizacion_rangos.md](optimizacion_rangos.md);
O3 (joins) sigue pendiente. Polars también optimiza el plan al ejecutarlo, por lo que el efecto
de los pases propios se mide comparando `-O0` con la versión optimizada.
La ejecución no es una transacción global entre todos los SINK: una salida ya
escrita puede persistir si otro bloque falla después. Los artefactos de
ejecuciones anteriores se conservan hasta que se vuelvan a generar.

Las pruebas cubren los ejemplos originales con resultados concretos, las diez
operaciones, composición, nulos, conectores, contratos, precisión decimal y
ejecución del `.py` generado desde otro directorio. Versiones verificadas:
Polars 2.1.0 y DuckDB 1.5.6 (ver `requirements.txt`).

El backend anterior, Python + SQL DuckDB, está descrito en
[backend_duckdb.md](backend_duckdb.md) y se conserva en el commit 4109895.
