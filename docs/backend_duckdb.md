# Backend Python + SQL DuckDB

## Compilación y ejecución

```text
.etl -> Lark -> AST -> validación -> Python con SQL -> DuckDB -> SINK
```

`python main.py` compila los programas de `input/` a `output/*.py`. La generación
de código valida nombres de conectores y sus opciones, ordena las declaraciones
topológicamente según `FLOW` y emite una función Python por pipeline. Los datos
no se consultan durante esta fase; los errores de archivos, columnas, tipos y
nulos de entrada aparecen al ejecutar.

`python main.py --run` compila y ejecuta. Cada archivo usa una conexión DuckDB
independiente en memoria. Los `SOURCE` nativos se adjuntan en modo de solo lectura.
Los pasos se materializan en tablas temporales nuevas: no modifican sus entradas.
Cada instancia `USE` invoca la función del pipeline correspondiente y enlaza sus
puertos lógicos; cada invocación crea sus propias tablas temporales.

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
.\.venv\Scripts\python.exe output\duckdb.py --base-dir input
```

## Conectores

Todas las opciones son literales. Las rutas, tablas, esquemas, delimitadores y
marcadores de nulos son cadenas; `header` es booleano. Los parámetros que no se
indican como opcionales son obligatorios.

| Conector | SOURCE | SINK | Opciones |
| --- | --- | --- | --- |
| `DUCKDB` | Sí | Sí | `file`, `table`, `schema` opcional (por defecto `main`); `mode` solo para SINK |
| `CSV` | Sí | Sí | `file`; `header` (TRUE), `delimiter` (","), `nullstr` ("") opcionales |
| `PARQUET` | Sí | Sí | `file` |
| `SQLITE` | Sí | No | `file`, `table` |

Los `SOURCE` requieren archivos locales existentes; no se aceptan patrones glob
ni URLs en esta implementación. Una opción `table: "schema.tabla"` se interpreta
como un solo nombre: para DuckDB se debe usar `schema: "schema", table: "tabla"`.

Los SINK CSV/Parquet crean las carpetas necesarias y reemplazan el archivo de
salida si ya existe. En CSV, un campo no entrecomillado igual a `nullstr` se lee
como `NULL`; los campos entrecomillados conservan el valor literal. Esto permite
distinguir `NULL` de la cadena vacía en el recorrido de escritura/lectura.

Un SINK DuckDB tiene `mode: "error"` por defecto (rechaza una tabla ya existente).
`mode: "replace"` la reemplaza; `mode: "append"` agrega filas a una tabla que debe
existir y enlaza las columnas por nombre. No se permite escribir mediante SINK
en una base que la misma ejecución adjuntó como SOURCE de solo lectura.

SQLite se importa con la biblioteca estándar `sqlite3`, en lotes de 1000 filas,
a una tabla temporal DuckDB. Así los ejemplos funcionan sin instalar extensiones
ni conectarse a internet. Las afinidades enteras se mapean a BIGINT, las textuales
a VARCHAR, BLOB a BLOB, REAL/NUMERIC/DECIMAL a DOUBLE y BOOL/DATE/DATETIME a sus
tipos correspondientes. Las declaraciones restantes usan VARCHAR. No se promete
precisión decimal exacta al importar columnas numéricas SQLite, ni soporte de
columnas con valores de tipos incompatibles con su declaración. Las operaciones
ETL posteriores se ejecutan enteramente en DuckDB.

## SQL y contratos

Los identificadores se delimitan con comillas dobles y los literales se escapan.
El backend no incorpora consultas SQL arbitrarias desde el DSL. `==` se traduce
a `=`, `COUNT()` a `COUNT(*)` y `SAFE_DIVIDE(a,b)` a `a / NULLIF(b,0)`.
`FILL_NULL` usa `COALESCE` y reemplaza solo columnas existentes; `DERIVE` debe
crear columnas nuevas. Las referencias de todas las asignaciones se validan
contra la entrada original, para evitar dependencias laterales entre aliases.

Los contratos `SOURCE`, `INPUT` y `OUTPUT` verifican columnas, orden, familias
de tipos y nulos reales. No convierten los datos. Los errores de columnas se
comprueban antes de enviar la consulta al motor, respetando mayúsculas y
minúsculas del DSL. JOIN rechaza nombres de salida coincidentes, incluso cuando
solo difieren en mayúsculas. Las condiciones de igualdad no hacen coincidir nulos.
Los diagnósticos incluyen el bloque y la ubicación del `.etl` cuando están disponibles.

`DECIMAL` es una familia numérica del contrato, sin escala/precisión declaradas.
Los datos DuckDB DECIMAL conservan su tipo; un REAL/DOUBLE de CSV o SQLite sigue
siendo REAL/DOUBLE. No se transforma implícitamente en un decimal exacto.

## API Python para puertos externos

Un módulo generado expone `PIPELINES` (funciones por nombre) y
`DEFAULT_PIPELINES` (raíces ejecutables). Una función recibe un `DuckDBRuntime`
y un diccionario que enlaza cada INPUT con una `Table` del mismo runtime. Retorna
un diccionario con las tablas de los OUTPUT y SINK. Las tablas siguen siendo
consultables mientras su conexión esté abierta.

```python
import runpy
from etl_dsl.runtime import DuckDBRuntime

module = runpy.run_path("output/credit_risk.py")
with DuckDBRuntime(base_dir="input") as rt:
    orders = rt.query("""SELECT 1::BIGINT AS id, 2::BIGINT AS customer_id,
                               NULL::DOUBLE AS amount, NULL::VARCHAR AS status""")
    outputs = module["PIPELINES"]["clean_orders"](rt, {"orders": orders})
    print(rt.connection.execute("SELECT * FROM " + outputs["cleaned"].sql).fetchall())
```

## Límites actuales y validación

La inferencia estática completa, la IR y los pases propios de optimización siguen
pendientes. Materializar cada paso da entradas estables, con un costo adicional
de memoria y escritura temporal; todavía no se fusionan operadores. La ejecución
no es una transacción global entre todos los SINK: una salida ya escrita puede
persistir si otro bloque falla después. Los artefactos de ejecuciones anteriores
se conservan hasta que se vuelvan a generar.

Las pruebas cubren los ejemplos originales con resultados concretos, las diez
operaciones, composición, nulos, conectores, contratos y ejecución del `.py`
generado desde otro directorio. La integración se verificó con DuckDB 1.5.6.

La implementación utiliza la [API Python de DuckDB](https://duckdb.org/docs/1.5/clients/python/overview),
[ATTACH](https://duckdb.org/docs/1.5/sql/statements/attach) para bases nativas y
[COPY](https://duckdb.org/docs/1.5/sql/statements/copy) para escribir archivos.
