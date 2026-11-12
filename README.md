# DSL ETL para Polars

Compilador implementado en Python con Lark y motor de ejecución **Polars**.
Genera Python legible con expresiones de Polars (`LazyFrame`). Usa la sintaxis
ETL-DSL v0.2: bloques `PIPELINE`, operaciones declaradas con
`STEP` y conexiones explícitas en `FLOW`.

El destino es **Python + Polars**, como en [la propuesta inicial](docs/Propuesta_DSL.md);
la sintaxis implementada corresponde a las
referencias v0.2, no al ejemplo de operadores `|>` de esa propuesta.

## Instalación y uso

Para un primer recorrido guiado, sin programar en Python, sigue el tutorial
[De un CSV a un resultado](docs/tutorial.md): usa `demo/tutorial.etl` y un CSV incluido.
La referencia del lenguaje está en [docs/lenguaje.md](docs/lenguaje.md) y la del backend
en [docs/backend_polars.md](docs/backend_polars.md).

Requiere Python 3.11 o posterior. En PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install -e . --no-deps
# Compilar todos los programas: input/*.etl -> output/*.py
.\.venv\Scripts\python.exe main.py
# Crear datos locales de demo y ejecutar los programas con Polars
.\.venv\Scripts\python.exe scripts\create_demo_data.py
.\.venv\Scripts\python.exe main.py --run
# Ejecutar directamente el Python ya generado
.\.venv\Scripts\python.exe output\duckdb.py
# Inspeccionar el frontend
.\.venv\Scripts\python.exe -m etl_dsl input\credit_risk.etl --format tree
.\.venv\Scripts\python.exe -m etl_dsl input\duckdb.etl --format ast
# IR antes y después de los pases de optimización
.\.venv\Scripts\python.exe -m etl_dsl demo\optimizaciones.etl --format ir
# La suite completa incluye el servicio POSIX; en Windows, usar Docker:
docker compose --profile tests run --build --rm tests
```

`main.py` procesa recursivamente los archivos `.etl` de `input/` y guarda el
Python generado en `output/`, conservando las subcarpetas. Compilar no lee ni
escribe datos de los conectores. `--run` ejecuta el código generado en una
proceso con Polars. Cada archivo
se analiza como un programa independiente; las referencias `USE` se resuelven
dentro del mismo archivo. Si alguno tiene errores, se informa el diagnóstico y
se continúa con los demás. Los archivos con otras extensiones se omiten.

```powershell
# Cambiar las carpetas o el formato de salida
.\.venv\Scripts\python.exe main.py input\credit_risk.etl --run --pipeline order_report
.\.venv\Scripts\python.exe main.py input\duckdb.etl --run --base-dir input
.\.venv\Scripts\python.exe main.py input --output output --format ast
.\.venv\Scripts\python.exe main.py input --output output --format tree
.\.venv\Scripts\python.exe main.py input --format tokens
.\.venv\Scripts\python.exe main.py input --format check
```

La salida predeterminada es `.py`. Los formatos de inspección son `.ast.json`,
`.ir.txt`, `.tree.txt` y `.tokens.json`; `check` solo valida el frontend.
Por defecto se aplican todos los pases de optimización; `-O0` los desactiva y
`--pases constantes,filtros` elige cuáles y en qué orden. El código generado
importa `etl_dsl.runtime`, por lo que debe ejecutarse en un entorno donde esté
instalado este proyecto. Los resultados generados se excluyen de Git.

Las rutas de `SOURCE` y `SINK` se resuelven respecto a la carpeta del `.etl`,
salvo que se especifique `--base-dir`. `output/` contiene código compilado; los
datos resultantes van a las rutas declaradas en cada `SINK`. En la demo se crean
`input/summary.parquet`, `input/orders_clean.csv` y
`input/out/ventas_por_cliente.parquet`.

Por defecto se ejecutan los pipelines que no son usados por otro `USE` y no
tienen `INPUT` externos. `--pipeline nombre` permite seleccionar uno y es
repetible. Los pipelines reutilizables se invocan a través de `USE`; para
ejecutarlos directamente con datos externos, se dispone de la API Python.

Tras instalar, también se puede usar `etl-dsl` para procesar `input/`, o
`etl-dsl archivo.etl` para compilar un archivo. Los formatos de inspección de un
archivo individual se muestran en consola; `--output output` permite guardarlos.
La CLI retorna `0` si las fases solicitadas pasan, incluido el análisis estático
de esquemas, tipos y nulabilidad, y `1` si encuentra
errores, falta la entrada o una carpeta no contiene programas. Los diagnósticos se escriben a stderr con
archivo, línea, columna y un indicador de posición.

```python
from pathlib import Path
from etl_dsl import compile_program, parse_file

program = parse_file("input/duckdb.etl")
python = compile_program(program, filename="input/duckdb.etl", base_dir="input")
Path("output/duckdb.py").write_text(python, encoding="utf-8")
```

`parse(text)` y `parse_file(path)` devuelven el AST o lanzan `ParseError` ante un
error sintáctico. `parse_tree(text)` permite inspeccionar el árbol concreto de
Lark. `validate(program)` devuelve diagnósticos estructurales sin acceder a datos.

`analyze(text, filename="programa.etl", artifacts=("ast", "ir_before", "ir_after", "python"))`
analiza texto en memoria y devuelve artefactos y diagnósticos estructurados, conservando
las fases disponibles si otra falla. `result.to_dict()` expone el contrato JSON
compartido por CLI y web. Véase [la API de análisis](docs/api_analisis.md).

## Docker

Imagen `python:3.12-slim` con las dependencias de `requirements.txt`:

```powershell
docker compose build
# Crear datos de demo, compilar input/*.etl -> output/ y ejecutar
docker compose run --rm etl
# Correr las pruebas dentro del contenedor
docker compose run --rm tests
```

`input/` y `output/` se montan como volúmenes, así que los resultados quedan en
el repositorio local.

## Ejemplo

```text
PIPELINE ventas {
    SOURCE datos: TABLE[cliente_id: INT, monto: DECIMAL?]
        = DUCKDB(file: "ventas.duckdb", table: "ventas");
    STEP completos = FILL_NULL { monto = 0; }
    STEP resumen = AGGREGATE {
        GROUP_BY cliente_id;
        SUM(monto) AS total;
        COUNT() AS cantidad;
    }
    SINK salida = PARQUET(file: "out/resumen.parquet");
    FLOW { datos -> completos -> resumen -> salida; }
}
```

## Componentes y alcance

```text
proyecto2-compis/
├── main.py                 # Entrada: input/ -> output/
├── input/                  # Programas .etl
├── output/                 # Python compilado y artefactos de inspección
├── etl_dsl/
│   ├── ast.py              # Nodos del árbol abstracto
│   ├── parser.py           # Análisis sintáctico y API parse
│   ├── scanner.py          # Scanner y configuración de Lark
│   ├── token.py            # Token e intervalos de origen
│   ├── visitor.py          # Constructor del AST y recorridos
│   ├── type.py             # Tipos escalares del DSL
│   ├── main.py             # Procesamiento de archivos y CLI
│   ├── ir.py               # IR: DAG de operadores y su formato textual
│   ├── passes.py           # Pases de optimización sobre la IR
│   ├── backend.py          # Generación de Python + Polars desde la IR
│   ├── runtime.py          # Conectores y ejecución en Polars
│   ├── sql.py              # Identificadores SQL para los conectores SQLite/DuckDB
│   ├── grammar.lark        # Gramática
│   ├── validation.py       # Validaciones estructurales
│   └── diagnostics.py      # Diagnósticos
├── demo/                   # Programas de demostración, CSV incluidos y tutorial.etl
├── tests/
├── scripts/                # Datos reproducibles de demo
└── docs/                   # Tutorial, lenguaje, backend, enunciado y propuesta inicial
```

Los módulos se mantienen dentro de `etl_dsl` para evitar conflictos con los
módulos estándar de Python llamados `ast` y `token`.

- [Gramática Lark](etl_dsl/grammar.lark): parser LALR con lexer contextual.
- [AST](etl_dsl/ast.py): nodos inmutables para declaraciones, operaciones,
  expresiones y conexiones. Cada nodo conserva su intervalo de origen.
- [Parser](etl_dsl/parser.py): analiza sintaxis y ofrece `parse` y `parse_file`.
- [Scanner](etl_dsl/scanner.py): ofrece `scan` para inspeccionar los tokens,
  omitiendo espacios y comentarios. La tokenización aislada usa el lexer básico;
  durante el parsing Lark resuelve las palabras clave con el lexer contextual.
- [Tokens](etl_dsl/token.py): clase `Token` con categoría, lexema y posición.
- [Visitor](etl_dsl/visitor.py): `ASTBuilder` transforma el árbol concreto en AST;
  `NodeVisitor` y `walk` permiten recorrerlo. Las validaciones usan `walk`.
- [Tipos](etl_dsl/type.py): catálogo `ScalarType` usado por el AST y su constructor.
- [IR](etl_dsl/ir.py): baja el AST a un DAG de operadores por pipeline, en orden
  topológico según `FLOW`, y lo imprime como texto (`--format ir`).
- [Pases](etl_dsl/passes.py): rangos (O1), JOIN verificados (O3), plegado de constantes, fusión de filtros y
  eliminación de pasos muertos (O4).
- [Backend](etl_dsl/backend.py): genera Python desde la IR optimizada, compila
  expresiones a Polars y traduce `USE` a llamadas entre funciones Python.
- [Runtime](etl_dsl/runtime.py): resuelve el plan de Polars paso a paso y verifica columnas,
  contratos de entrada/salida, ambigüedad y garantías locales en JOIN.
- [Validaciones](etl_dsl/validation.py): nombres duplicados, enlaces y puertos,
  entradas requeridas, ciclos en `FLOW` y `USE`, comparaciones directas con
  `NULL`, aridad de funciones y condiciones de JOIN.
- [Pruebas](tests/test_frontend.py): programas de referencia, operaciones,
  precedencia, errores, composición y CLI.

Se ejecutan las diez operaciones del DSL, con las funciones escalares y
agregaciones de la gramática. Hay lectura de DuckDB, CSV, Parquet y SQLite;
escritura de DuckDB, CSV y Parquet. SQLite se importa mediante `sqlite3`, sin
descargar extensiones, y DuckDB solo se usa como conector (sin `pyarrow`);
todas las transformaciones se ejecutan en Polars.

Los contratos comprueban nombres, orden, familias de tipos y nulabilidad en
ejecución. Los pasos son `LazyFrame` y solo se calculan en un `SINK` (o en un
contrato que verifica nulos o la garantía de un JOIN). C2, O1 (rangos) y O3
(joins con obligaciones verificables) están implementados. [docs/backend_polars.md](docs/backend_polars.md) describe este backend;
[docs/backend_duckdb.md](docs/backend_duckdb.md), el backend DuckDB anterior (commit 4109895).

La referencia de sintaxis y las decisiones para el backend están en
[docs/lenguaje.md](docs/lenguaje.md). Los requisitos académicos están en
[docs/Enunciado_DSL.md](docs/Enunciado_DSL.md).

El análisis estático C2 no lee datasets y conserva las comprobaciones de datos
en ejecución. Reglas, conocimiento parcial y límites: [semántica estática](docs/semantica_estatica.md).

El pase O1 `rangos` elimina predicados implicados por filtros previos y registra
sus pruebas en la IR. [Reglas y demo](docs/optimizacion_rangos.md).

### JOIN con garantía verificable (C4)

`VERIFY MANY_TO_ONE;` en un INNER JOIN de clave simple exige unicidad derecha,
claves no nulas del mismo dtype físico y referencia total desde la izquierda.
El pase `joins`, activo por defecto antes de `muertos`, elimina la combinación
de columnas solo si todos los consumidores inmediatos son SELECT del lado
izquierdo. Las validaciones y ambas lecturas permanecen, incluso con -O0.

Demo reproducible: `.venv/bin/python main.py demo/joins.etl --run --output /tmp/cauce-c4`.
Contrato de análisis actual: versión 4. Reglas y límites: [C4](docs/optimizacion_joins.md).

### Evaluación reproducible (C5)

```sh
# Desde la raíz, con requirements.txt instalado; elegir un destino nuevo.
.venv/bin/python -m benchmarks --mode small --output benchmarks/results/small
.venv/bin/python -m benchmarks --mode measure --output benchmarks/results/medicion
```

El arnés genera datos con semilla fija, exige equivalencia antes de medir y
compara O0, cada pase, la combinación predeterminada y Polars manual con los
mismos contratos. Separa compilación de ejecución completa, incluidas las
validaciones de C4; exporta muestras, medianas/IQR, evidencia IR, entorno y un
reporte Markdown. Los artefactos generados quedan fuera de Git.
El segundo escenario controla solo los collect finales de Polars.
Comandos, workloads, resultados y límites: [evaluación C5](docs/evaluacion.md).

La campaña representativa medida el 11 de noviembre de 2026 sobre `efe1399` se publica en
`/evaluacion` como evidencia histórica. La página indica, con una comparación calculada por
`gen_evaluation.py`, si las fuentes medidas (compilador, arnés y programas) coinciden con las del código
que la publica (hoy coinciden las 37; `benchmarks/evidence.py` se añadió después); máquina, entorno y
fecha siguen siendo los de la campaña, y `--check` falla si esa conclusión deja de ser cierta. Una instantánea versionada
(`web/public/evidencia/c5-representativa/`, siete archivos y `manifest.json` con hashes del original
y del publicado) permite generar la página y sus descargas desde un checkout limpio; solo
`metadata.public.json` está depurado (ruta local del intérprete).

```sh
.venv/bin/python web/scripts/gen_evaluation.py          # valida la instantánea y genera los datos web
.venv/bin/python web/scripts/gen_evaluation.py --check  # falla si algo diverge
```

### Web Cauce (W1 completo, C/W2, D/W3, E y W4)

La web Vite/React conserva el landing en `/`, ofrece `/ejemplos`, `/ejemplos/:slug`, `/docs`, `/docs/:slug`,
la evidencia experimental C5 en `/evaluacion` y el espacio de trabajo en `/estudio`:
editor CodeMirror con sugerencias según el contexto (columnas, declaraciones y puertos, pipelines, conectores y aridad,
tomadas del último análisis válido), compilación local real con Pyodide, inspectores estructurados y diagnósticos seleccionables.
Permite importar/exportar `.etl`, descargar Python vigente y recuperar borradores versionados
tras recargar. En escritorio, un divisor accesible ajusta el ancho de editor e inspector (recordado solo en
este navegador, `cauce-studio-layout-v1`); `/estudio?vista=resultado|tokens|arbol|ast|flow|ir|esquemas|python|ejecucion`
abre esa vista del documento activo sin llevar documento ni datos en la URL. La ejecución real se realiza en el servicio Python privado descrito más abajo; el navegador no ejecuta Polars.

```sh
cd web
npm install
npm run dev -- --host 127.0.0.1 --port 5174
npm test
npm run build
# Desde la raíz, con Vite activo y playwright-cli en PATH:
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5174/
```

Las revisiones invalidan resultados anteriores; el worker limita carga/compilación y permite reiniciar
sin perder el documento. Persistencia local: hasta 128 KiB por documento, 8 anteriores y 512 KiB total;
si falla el guardado, descargar antes de salir. Rutas, fallback de hosting, comandos, recuperación y
límites en [web/README.md](web/README.md). Navegar por catálogo o documentación conserva el documento;
solo Abrir una copia lo reemplaza y guarda el anterior como borrador, sin expulsarlo al alcanzar el límite.

El catálogo publica ventas, gasto por cliente (programa del tutorial), riesgo crediticio, corrección de NULL
(ejercicio inválido), rangos y JOIN verificado. Siete guías cubren primeros pasos, el tutorial «De un CSV a un
resultado», estructura, operaciones/expresiones, NULL/contratos/diagnósticos, conectores y composición. `web/content/examples.json` y `articles.json` seleccionan las fuentes canónicas;
`.venv/bin/python web/scripts/gen_content.py` genera el contenido web sin copiar programas a mano.
Los artículos reutilizan secciones de documentación vigente; no publican propuestas ni planificación.

El paso C añade AST expandible, FLOW de lectura por pipeline y comparación de IR por procedencia,
con texto/JSON alternativos y selección del fuente Unicode. Los cinco pases se pueden seleccionar y ordenar;
`null` (predeterminados), `[]` (O0) y listas explícitas conservan su identidad y revisión en los borradores v1.
Los esquemas corresponden a la IR original y los hechos de rangos a una etapa intermedia. La evidencia JOIN
separa declaración, prueba estática y obligaciones dinámicas pendientes; compilar no valida datos. No se
inventan trazas para constantes, filtros o muertos ni correspondencia entre Python generado y líneas DSL.

Verificación de esta entrega: **157 pruebas Python**, **38 web**, demos regeneradas, build y recorridos
reales con `playwright-cli` en Vite y preview. Se conservan las 32 comparaciones CPython/Pyodide,
O1/O3 y recuperación del worker. (Estado de aquella entrega; W1 se completó después.)
Paso C/W2 queda implementado; el servicio del paso D/W3 se describe en la sección siguiente. Las cifras experimentales de C5 no cambian.

El paso E añade `/evaluacion`: metodología, campaña y entorno históricos, tabla y diagrama de puntos
por celda comparable (fase, programa, filas, escenario y configuraciones validados en la URL), evidencia
estructural y JOIN, corpus de errores, expresividad, límites, reproducción y descargas con SHA-256.
Se carga en diferido, no usa CodeMirror, Pyodide, el cliente de ejecución ni la API, y no modifica el
documento del estudio. Verificación del paso E: **170 pruebas Python** (también en Docker), **45 web**,
generadores con `--check`, build y recorridos `playwright-cli` en Vite, build servido por FastAPI y Docker.
Detalle: [publicación de la evidencia](docs/evaluacion.md#publicación-de-la-evidencia-y-página-evaluacion-paso-e).

### Ejecución web privada (paso D / W3)

El estudio ahora ejecuta mediante una API Python local/privada y conserva la compilación local Pyodide independiente. No se ha realizado un despliegue público.

```sh
# Desde la raíz; en un entorno creado con uv puede usarse uv pip install --python .venv/bin/python -r requirements-service.txt
.venv/bin/python -m pip install -r requirements-service.txt
.venv/bin/python -m service.prepare
.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
# Otra terminal: cd web && npm ci && npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
# O después del build: abrir http://127.0.0.1:8000/estudio
```

En Resultados, elegir pipeline, enlazar datasets del catálogo y pulsar Ejecutar. Ventas: `ventas.pedidos → orders@1`. JOIN utiliza los dos CSV incluidos sin preparación; ventas/riesgo/rangos necesitan `service.prepare`, que reutiliza el generador canónico y prepara rangos por separado. La API informa disponibilidad y versiones; el ejercicio NULL se ejecuta después de corregirlo. También funcionan INPUT directo y composición USE.

La API `/api/v1` acepta fuente ETL, recompila en un proceso hijo y mantiene queued/running/estados terminales en SQLite. Previews paginados, esquema observado y descargas por manifiesto; OUTPUT se materializa como Parquet. Revisión, pases (null, O0 y orden explícito), pipeline y bindings identifican cada resultado. Un cambio marca resultados anteriores; no ejecuta automáticamente ni afecta a CodeMirror. Borradores v1 sin cambios; referencias de trabajos solo en memoria de la pestaña.

Límites privados: un activo/cuatro posiciones adicionales, 30 s, RSS muestreado de 512 MiB, archivos acotados y caducidad de una hora. Cancelar termina el hijo; reiniciar limpia huérfanos sin reanudación. Los contratos dinámicos y las obligaciones JOIN permanecen con O0 y optimización. No hay transacción global ni sandbox público. Docker: `docker compose --profile web up --build cauce`, accesible solo en loopback.

Contrato HTTP 1 (distinto del análisis JSON 4), comandos, límites completos, persistencia, serialización y verificación: [guía del servicio](docs/servicio_ejecucion.md). W1 está completo (cierre con divisor de paneles, enlaces a vistas y auditoría de estados del estudio; ver [web/README.md](web/README.md#cierre-de-w1-divisor-de-paneles-y-enlaces-a-vistas)). La documentación final del lenguaje y el tutorial están publicados (ver más abajo). Las sugerencias semánticas (W4) están implementadas (ver «Sugerencias del editor» más abajo). Sigue pendiente la evaluación con usuarios; el constructor visual sigue fuera de alcance. No se modificaron las cifras C5.

### Documentación final y tutorial

[docs/tutorial.md](docs/tutorial.md) lleva de `demo/joins_pedidos.csv` (incluido, sin preparación) a
`demo/out/gasto_por_cliente.csv` con `demo/tutorial.etl`: contrato, filtro, columna derivada, agregación, un error real
y su corrección, compilación, ejecución desde el estudio y con `--run`, y el archivo de salida. Se publica en `/docs/tutorial`.
`tests/test_tutorial.py` ejecuta sus comandos y compara las salidas mostradas, también a través del servicio privado.
[docs/lenguaje.md](docs/lenguaje.md) y [docs/backend_polars.md](docs/backend_polars.md) describen la implementación vigente
(gramática, diez operaciones, NULL, contratos, C2, cinco pases, conectores y runtime). Verificación: **180 pruebas Python**
(también en Docker, 2 omitidas allí), **52 web** y recorridos `playwright-cli` del tutorial en Vite, FastAPI y Docker.

### Sugerencias del editor (W4)

El editor del estudio sugiere lo que cabe donde está el cursor: columnas de la entrada de cada STEP (desde el artefacto
`schemas` de la IR original y las entradas de `ir_before`), declaraciones y puertos en FLOW (JOIN `.left/.right` y los
INPUT/OUTPUT de cada USE), `left.`/`right.` solo en `ON`, pipelines tras `USE`, conectores y opciones reales según
SOURCE/SINK, y funciones/agregaciones con su aridad. El contenido sale del último análisis del documento con esos
artefactos (contrato 4, sin una segunda semántica en TypeScript); si el texto cambió desde entonces, la lista lo rotula
como «Último análisis válido · revisión N». Un esquema parcial solo ofrece las columnas conocidas y lo indica. En `E_COLUMN`,
«¿quisiste decir …?» corrige el intervalo exacto sin cambiar el diagnóstico. Pedir sugerencias no compila. Detalle en
[web/README.md](web/README.md#sugerencias-del-editor-w4); verificación: **180 pruebas Python**, **64 web** y
`verify_browser.py --suggestions-only` en Vite, FastAPI y Docker.
