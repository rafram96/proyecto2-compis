<p align="center">
  <img src="docs/img/capybara.png" alt="Logo de CaPybara" width="420">
</p>

<p align="center">
  <img src="docs/img/titulo.png" alt="CaPybara" width="420">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/CS3025-Compiladores-00b4f0?labelColor=1f1f1f" alt="CS3025 · Compiladores">
</p>
<p align="center">
  <img src="https://img.shields.io/badge/Gabriel-Vargas%20Urmeneta-8cc2ff" alt="Gabriel Vargas Urmeneta">
  <img src="https://img.shields.io/badge/Rafael-Ramos%20Huaman%C3%AD-fa6557" alt="Rafael Ramos Huamaní">
  <img src="https://img.shields.io/badge/Angel-Tribe%C3%B1o%20Hurtado-88f7c7" alt="Angel Tribeño Hurtado">
  <img src="https://img.shields.io/badge/David-Silva%20Mena-ffc2f5" alt="David Silva Mena">
</p>

**CaPybara** es un lenguaje de dominio específico para pipelines ETL. Su compilador verifica
columnas y tipos antes de tocar los datos y genera Python legible con Polars.

```text
.etl → Lark (léxico y sintaxis) → AST → IR → tipos → optimizaciones → Python + Polars
```

## Ejemplo

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

Además de esta forma lineal existe la forma de grafo (`SOURCE`, `STEP`, `SINK` y `FLOW`), necesaria
para `JOIN`, `INPUT`/`OUTPUT` y `USE`. Referencia completa en [docs/lenguaje.md](docs/lenguaje.md).

## Uso con Docker

```bash
docker compose up --build web        # entorno web en http://127.0.0.1:8000
docker compose run --rm etl          # compila input/*.etl en output/ y lo ejecuta
docker compose run --rm tests        # pruebas
```

## Uso local

Python 3.11 o posterior.

```bash
python -m venv .venv
.venv\Scripts\activate               # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
pip install -e . --no-deps
python scripts/create_demo_data.py   # datos de ejemplo en input/

python main.py --run                              # compilar y ejecutar input/
python -m etl_dsl demo/optimizaciones.etl --format ir   # ver una fase
python -m etl_dsl.web                             # entorno web
python -m unittest discover                       # pruebas
```

| Opción | Efecto |
| --- | --- |
| `--format` | `python` (por defecto), `tokens`, `tree`, `ast`, `ir` o `check` |
| `-O0` | sin optimizaciones de CaPybara; Polars conserva su propio optimizador |
| `--pases constantes,filtros,codigo_muerto` | elige los pases y su orden |
| `--run` / `--pipeline nombre` | ejecuta todo o un pipeline |

## Entorno web

Editor con resaltado y errores en vivo, y una pestaña por fase: tokens, árbol de derivación, AST,
IR antes y después de optimizar (como texto y como grafo), código generado y resultados de la
ejecución. La página `/benchmarks.html` muestra la evaluación experimental.

## Benchmarks

Comparación con Polars, Pandas y DuckDB escritos a mano sobre TPC-H, de SF 1 a SF 30.
Instrucciones para reproducirlos en [bench/README.md](bench/README.md); los resultados están en
`bench/resultados/`.

### Generación de código con LLMs

[`bench-LLM/`](bench-LLM/README.md) adapta 80 tareas del benchmark de Anka. La evaluación
principal usa las 60 tareas sin incompatibilidades conocidas con CaPybara y registra las
20 exclusiones. Compara programas generados por Junie para CaPybara y Python con Polars.
Cada tarea recibe su esquema y una guía del lenguaje; los tests se ejecutan después,
sin mostrar sus resultados al modelo ni corregir las respuestas.

| Corrida | CaPybara | Comparador | Errores de CaPybara por omitir `;` |
| --- | ---: | ---: | ---: |
| Python puro, guía inicial | 38/60 (63,3 %) | 50/60 (83,3 %) | 16 |
| Polars, guía inicial | 42/60 (70 %) | 48/60 (80 %) | 12 |
| Polars, guía reforzada | 50/60 (83,3 %) | 41/60 (68,3 %) | 0 |

Estas corridas usaron Junie Lite (`Qwen/Qwen3.6-27B-FP8`) con una respuesta por tarea y
lenguaje. El refuerzo del prompt se hizo después de observar errores; los resultados
son exploratorios e incluyen fallos de formato de Junie. La variación de Polars con el
mismo prompt impide atribuir toda la diferencia al cambio de guía.

Las [respuestas, evaluaciones y manifiestos](bench-LLM/resultados/) de las tres corridas
están versionados. Para preparar y revisar prompts sin llamar a un LLM:

```bash
python bench-LLM/benchmark.py preparar --baseline polars
python -m unittest discover -s bench-LLM/tests -v
```

La [guía del benchmark](bench-LLM/README.md) explica cómo exportar solo los prompts,
evaluar respuestas guardadas y usar Junie desde CMD en sesiones fuera del repositorio,
con las herramientas externas bloqueadas. Ejecutar `junie_runner.py` sí envía solicitudes
al servicio; los tests locales anteriores no consumen llamadas al modelo.

## Reporte técnico

La versión actual es [reporte/main_v2.pdf](reporte/main_v2.pdf), con su
[fuente LaTeX](reporte/main_v2.tex). Incluye diseño, implementación, evaluación TPC-H
y **usabilidad para LLMs**, con tablas y gráficos generados desde los resultados guardados.
Esta última sección estudia generación de programas, y se distingue de un estudio con
personas. El PDF tiene 10 páginas de contenido, más referencias y apéndices.

La [documentación del reporte](reporte/README.md) describe cómo regenerar sus figuras
y compilar el PDF. La primera versión se conserva en `reporte/main.tex` y `main.pdf`.

## Estructura

```text
etl_dsl/
├── grammar.lark     gramática (Lark, LALR)
├── parser.py        análisis léxico y sintáctico
├── visitor.py       árbol de derivación → AST
├── validation.py    validaciones estructurales
├── ir.py            IR: DAG de operadores por pipeline
├── typecheck.py     inferencia de esquemas y verificación de tipos
├── passes.py        optimizaciones
├── backend.py       generación de Python + Polars
├── runtime.py       conectores y ejecución
└── web/             servidor FastAPI y entorno web
bench/               benchmarks, tareas y corpus de errores
bench-LLM/           generación con LLMs, evaluación y evidencia de las corridas
demo/, input/        programas de ejemplo
docs/                referencia del lenguaje y del backend
reporte/             artículos LaTeX/PDF y generadores de tablas y gráficos
tests/               pruebas
```
