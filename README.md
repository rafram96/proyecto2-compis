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
| `-O0` | sin optimizaciones |
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
demo/, input/        programas de ejemplo
docs/                referencia del lenguaje y del backend
reporte/             reporte técnico (LaTeX)
tests/               pruebas
```
