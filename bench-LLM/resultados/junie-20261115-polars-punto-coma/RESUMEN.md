# Benchmark de generación con Junie

- Inicio: 2026-11-16T00:37:41.007242+00:00
- Alias: `junie-lite`; modelo informado: Qwen/Qwen3.6-27B-FP8.
- Tareas seleccionadas: 60 de 80; exclusiones registradas: 20.
- Una respuesta por tarea y lenguaje; sesiones nuevas y sin feedback de tests.
- Comparación: Capybara frente a Python con Polars.
- Generaciones: 120/120; corrida completa: True.
- Muestras emparejadas entre lenguajes: True.
- Intentos de herramientas externas bloqueados: 0.

| Lenguaje | Respuestas | Sintaxis válida | Pasan todos los tests | Exactitud |
|---|---:|---:|---:|---:|
| Capybara | 60 | 54 | 50 | 83.3% |
| Python con Polars | 60 | 44 | 41 | 68.3% |

## Resultados por categoría

| Categoría | Capybara | Python con Polars |
|---|---:|---:|
| aggregate | 9/10 | 9/10 |
| filter | 8/9 | 7/9 |
| finance | 16/18 | 11/18 |
| hard | 7/8 | 5/8 |
| map | 3/4 | 3/4 |
| multi_step | 5/8 | 5/8 |
| strings | 2/3 | 1/3 |

## Fallos

### capybara

compile_error: 9, wrong_output: 1

- `agg_002`: compile_error. E_SYNTAX: Símbolo inesperado: "Counted"; se esperaba: "PIPELINE"
- `multi_004`: compile_error. E_SYNTAX: Símbolo inesperado: "AS"; se esperaba: ",", ";"
- `filter_002`: compile_error. E_SYNTAX: Símbolo inesperado: "Filter"; se esperaba: "PIPELINE"
- `multi_005`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `multi_010`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `map_002`: compile_error. E_SYNTAX: Símbolo inesperado: "Add"; se esperaba: "PIPELINE"
- `fin_020`: compile_error. E_SYNTAX: Símbolo inesperado: "Capybara"; se esperaba: "PIPELINE"
- `fin_006`: compile_error. E_SYNTAX: Símbolo inesperado: "Given"; se esperaba: "PIPELINE"
- `str_003`: wrong_output.
- `hard_004`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: product_id y product_id.

### polars

compile_error: 16, runtime_error: 1, wrong_output: 2

- `filter_002`: compile_error. invalid syntax (candidate.py, line 1)
- `map_003`: compile_error. invalid syntax (candidate.py, line 1)
- `multi_010`: wrong_output.
- `fin_017`: compile_error. invalid syntax (candidate.py, line 1)
- `str_002`: compile_error. invalid character '—' (U+2014) (candidate.py, line 7)
- `hard_007`: compile_error. unterminated string literal (detected at line 11) (candidate.py, line 11)
- `multi_004`: wrong_output.
- `str_003`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_013`: compile_error. invalid syntax (candidate.py, line 1)
- `hard_006`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_012`: compile_error. invalid syntax (candidate.py, line 1)
- `hard_010`: compile_error. invalid syntax (candidate.py, line 1)
- `agg_003`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_005`: compile_error. invalid syntax (candidate.py, line 1)
- `filter_010`: runtime_error. TypeError: the truth value of an Expr is ambiguous  You probably got here by using a Python standard library function instead of the native expressions API. Here are some things you might want to try: - instead of `pl.col('a') and pl.col('b')`, use `
- `fin_003`: compile_error. invalid syntax (candidate.py, line 1)
- `multi_001`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_020`: compile_error. unterminated string literal (detected at line 11) (candidate.py, line 11)
- `fin_019`: compile_error. invalid syntax (candidate.py, line 1)

## Observaciones de esta corrida

- 0 respuestas de Capybara fallaron por omitir el punto y coma requerido tras la fuente.
- Algunas respuestas de Junie describen una solución sin entregar código: se conservaron y se contabilizaron como fallos, sin volver a solicitarlas.
- Respuestas descriptivas sin bloque de código detectadas: filter_002 (polars), agg_002 (capybara), map_003 (polars), fin_017 (polars), str_002 (polars), hard_007 (polars), filter_002 (capybara), str_003 (polars), fin_013 (polars), map_002 (capybara), hard_006 (polars), fin_012 (polars), fin_020 (capybara), hard_010 (polars), agg_003 (polars), fin_005 (polars), fin_003 (polars), fin_006 (capybara), multi_001 (polars), fin_020 (polars), fin_019 (polars).
- El caso original `str_003` usa las secuencias literales `\t` y `\n` en el JSON (barras escapadas), pero espera eliminarlas como si fueran caracteres de espacio en blanco. El resultado conserva la referencia original; conviene revisar esta inconsistencia del corpus antes de atribuir ese fallo al lenguaje.

## Alcance

Estos resultados corresponden a esta versión de los prompts y de Junie. Junie puede hacer varias llamadas internas por respuesta; no representan una llamada directa al modelo ni una comparación de velocidad de ejecución. Las respuestas no se corrigieron y los tests no se mostraron al generador. El criterio de corrección usa las salidas esperadas del corpus original de Anka. Una muestra por tarea no mide la variabilidad entre intentos.
