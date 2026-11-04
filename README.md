# DSL ETL para DuckDB

Compilador implementado en Python con Lark y motor de ejecución **DuckDB**.
Genera Python legible con consultas SQL. Usa la sintaxis
ETL-DSL v0.2: bloques `PIPELINE`, operaciones declaradas con
`STEP` y conexiones explícitas en `FLOW`.

El destino elegido para el proyecto es **DuckDB**. [La propuesta inicial](docs/Propuesta_DSL.md) conserva la
propuesta inicial con Polars; la sintaxis implementada corresponde a las
referencias v0.2, no al ejemplo de operadores `|>` de esa propuesta.

## Instalación y uso

Requiere Python 3.11 o posterior. En PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
# Compilar todos los programas: input/*.etl -> output/*.py
.\.venv\Scripts\python.exe main.py
# Crear datos locales de demo y ejecutar los programas en DuckDB
.\.venv\Scripts\python.exe scripts\create_demo_data.py
.\.venv\Scripts\python.exe main.py --run
# Ejecutar directamente el Python ya generado
.\.venv\Scripts\python.exe output\duckdb.py
# Inspeccionar el frontend
.\.venv\Scripts\python.exe -m etl_dsl input\credit_risk.etl --format tree
.\.venv\Scripts\python.exe -m etl_dsl input\duckdb.etl --format ast
.\.venv\Scripts\python.exe -m unittest discover -v
```

`main.py` procesa recursivamente los archivos `.etl` de `input/` y guarda el
Python generado en `output/`, conservando las subcarpetas. Compilar no lee ni
escribe datos de los conectores. `--run` ejecuta el código generado en una
conexión DuckDB en memoria. Cada archivo
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
`.tree.txt` y `.tokens.json`; `check` solo valida el frontend. El código generado
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
│   ├── backend.py          # Generación de Python + SQL
│   ├── runtime.py          # Conectores y ejecución en DuckDB
│   ├── sql.py              # Delimitación de identificadores y literales
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
- [Backend](etl_dsl/backend.py): ordena `FLOW`, compila expresiones a SQL y
  traduce `USE` a llamadas entre funciones Python.
- [Runtime](etl_dsl/runtime.py): ejecuta SQL con DuckDB y verifica columnas,
  contratos de entrada/salida y ambigüedad en JOIN.
- [Validaciones](etl_dsl/validation.py): nombres duplicados, enlaces y puertos,
  entradas requeridas, ciclos en `FLOW` y `USE`, comparaciones directas con
  `NULL`, aridad de funciones y condiciones de JOIN.
- [Pruebas](tests/test_frontend.py): programas de referencia, operaciones,
  precedencia, errores, composición y CLI.

Se ejecutan las diez operaciones del DSL, con las funciones escalares y
agregaciones de la gramática. Hay lectura de DuckDB, CSV, Parquet y SQLite;
escritura de DuckDB, CSV y Parquet. SQLite se importa mediante `sqlite3`, sin
descargar extensiones; todas las transformaciones se ejecutan en DuckDB.

Los contratos comprueban nombres, orden, familias de tipos y nulabilidad en
ejecución. Los pasos se materializan en tablas temporales. Quedan pendientes el
análisis estático completo de tipos, la IR y los pases de optimización del
proyecto. El backend y sus límites se describen en
[docs/backend_duckdb.md](docs/backend_duckdb.md).

La referencia de sintaxis y las decisiones para el backend están en
[docs/lenguaje.md](docs/lenguaje.md). Los requisitos académicos están en
[docs/Enunciado_DSL.md](docs/Enunciado_DSL.md).
