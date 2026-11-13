# DSL ETL para Polars

Compilador implementado en Python con Lark y motor de ejecución **Polars**.
Genera Python legible con expresiones de Polars (`LazyFrame`). Usa la sintaxis
ETL-DSL v0.3: bloques `PIPELINE` en dos formas, una **lineal** (`FROM`,
operaciones en orden y `TO`) para cadenas simples y otra de **grafo**, con
operaciones declaradas con `STEP` y conexiones explícitas en `FLOW`.

El destino es **Python + Polars**, como en [la propuesta inicial](docs/Propuesta_DSL.md);
la sintaxis implementada corresponde a las
referencias v0.2, no al ejemplo de operadores `|>` de esa propuesta.

## Instalación y uso

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
.\.venv\Scripts\python.exe -m unittest discover -v
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
La CLI retorna `0` si la sintaxis y estructura son válidas, y `1` si encuentra
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

## Entorno web

Editor Monaco con resaltado del DSL y errores léxicos, sintácticos, estructurales
y de tipos marcados mientras se escribe. A la derecha muestra el grafo de la IR
antes y después de optimizar, el AST, la IR en texto, el código Polars generado
y las tablas que produce cada `SINK` y `OUTPUT` al ejecutar.

```powershell
.\.venv\Scripts\python.exe scripts\create_demo_data.py
.\.venv\Scripts\python.exe -m etl_dsl.web          # http://127.0.0.1:8000
# o con Docker
docker compose up web
```

`/?ejemplo=demo/tipos.etl` abre un ejemplo directamente. `Ctrl + Enter` ejecuta.
Al hacer clic en un nodo del grafo, en un nodo del AST o en un problema, se
selecciona su declaración en el editor. Los programas solo pueden leer y escribir
dentro de `input/`, que también es la base de las rutas relativas; el servidor
escucha solo en este equipo salvo que se indique `--host`.

| Endpoint | Qué hace |
| --- | --- |
| `POST /api/compile` | `{"source", "passes"?}` → diagnósticos, AST, IR antes y después con su grafo y esquemas, y código |
| `POST /api/run` | Lo mismo, más las primeras 100 filas de cada `SINK` y `OUTPUT` |
| `GET /api/examples` | Programas de `input/` y `demo/` |

La lógica está en `etl_dsl/api.py` (`compile_source`, `run_source`), que no
depende de FastAPI: cada fase devuelve lo que alcanzó a producir aunque una
fase posterior falle. Monaco se carga desde jsDelivr, así que el navegador
necesita conexión a internet.

## Ejemplo

Forma lineal: cada línea recibe el resultado de la anterior.

```text
PIPELINE ventas {
    FROM DUCKDB(file: "ventas.duckdb", table: "ventas")
        AS TABLE[cliente_id: INT, monto: DECIMAL?];
    FILL_NULL { monto = 0; }
    AGGREGATE {
        GROUP_BY cliente_id;
        SUM(monto) AS total;
        COUNT() AS cantidad;
    }
    TO PARQUET(file: "out/resumen.parquet");
}
```

El mismo pipeline en forma de grafo, necesaria para `JOIN`, `INPUT`/`OUTPUT` y `USE`:

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
│   ├── api.py              # Compilar y ejecutar texto -> JSON (para el entorno)
│   ├── web/                # Servidor FastAPI y página del editor (static/)
│   ├── ir.py               # IR: DAG de operadores y su formato textual
│   ├── typecheck.py        # Esquemas inferidos y verificación de tipos
│   ├── passes.py           # Pases de optimización sobre la IR
│   ├── backend.py          # Generación de Python + Polars desde la IR
│   ├── runtime.py          # Conectores y ejecución en Polars
│   ├── sql.py              # Identificadores SQL para los conectores SQLite/DuckDB
│   ├── grammar.lark        # Gramática
│   ├── validation.py       # Validaciones estructurales
│   └── diagnostics.py      # Diagnósticos
├── tests/
├── scripts/                # Datos reproducibles de demo
└── docs/                   # Lenguaje, backend, enunciado y propuesta inicial
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
- [Tipos](etl_dsl/typecheck.py): infiere el esquema de cada nodo de la IR y
  reporta al compilar columnas inexistentes, tipos incompatibles y contratos
  que no se cumplen.
- [Pases](etl_dsl/passes.py): plegado de constantes, fusión de filtros y
  eliminación de código muerto (O4).
- [Backend](etl_dsl/backend.py): genera Python desde la IR optimizada, compila
  expresiones a Polars y traduce `USE` a llamadas entre funciones Python.
- [Runtime](etl_dsl/runtime.py): resuelve el plan de Polars paso a paso y verifica columnas,
  contratos de entrada/salida y ambigüedad en JOIN.
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
contrato que verifica nulos), así que Polars optimiza el plan completo. Los tipos se
verifican al compilar cuando los esquemas se conocen; quedan pendientes los pases O1 (rangos) y O3 (joins). [docs/backend_polars.md](docs/backend_polars.md) describe este backend;
[docs/backend_duckdb.md](docs/backend_duckdb.md), el backend DuckDB anterior (commit 4109895).

La referencia de sintaxis y las decisiones para el backend están en
[docs/lenguaje.md](docs/lenguaje.md). Los requisitos académicos están en
[docs/Enunciado_DSL.md](docs/Enunciado_DSL.md).
