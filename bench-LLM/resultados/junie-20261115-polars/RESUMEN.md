# Benchmark de generación con Junie

- Inicio: 2026-11-16T00:15:45.662428+00:00
- Alias: `junie-lite`; modelo informado: Qwen/Qwen3.6-27B-FP8.
- Tareas seleccionadas: 60 de 80; exclusiones registradas: 20.
- Una respuesta por tarea y lenguaje; sesiones nuevas y sin feedback de tests.
- Comparación: Capybara frente a Python con Polars.
- Generaciones: 120/120; corrida completa: True.
- Muestras emparejadas entre lenguajes: True.
- Intentos de herramientas externas bloqueados: 0.

| Lenguaje | Respuestas | Sintaxis válida | Pasan todos los tests | Exactitud |
|---|---:|---:|---:|---:|
| Capybara | 60 | 46 | 42 | 70.0% |
| Python con Polars | 60 | 51 | 48 | 80.0% |

## Resultados por categoría

| Categoría | Capybara | Python con Polars |
|---|---:|---:|
| aggregate | 6/10 | 8/10 |
| filter | 6/9 | 6/9 |
| finance | 16/18 | 13/18 |
| hard | 7/8 | 8/8 |
| map | 2/4 | 4/4 |
| multi_step | 3/8 | 6/8 |
| strings | 2/3 | 3/3 |

## Fallos

### capybara

compile_error: 17, wrong_output: 1

- `multi_004`: compile_error. E_SYNTAX: Símbolo inesperado: "AS"; se esperaba: ",", ";"
- `agg_003`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `map_001`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `filter_001`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_005`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `multi_010`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `agg_004`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `agg_009`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `fin_001`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `fin_017`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `str_003`: wrong_output.
- `agg_006`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `filter_006`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `map_005`: compile_error. E_SYNTAX: Símbolo inesperado: "-"; se esperaba: "PIPELINE"
- `multi_001`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_002`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `hard_004`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: product_id y product_id.
- `filter_005`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="

### polars

compile_error: 9, runtime_error: 2, wrong_output: 1

- `multi_010`: wrong_output.
- `fin_017`: compile_error. unterminated string literal (detected at line 4) (candidate.py, line 4)
- `multi_004`: runtime_error. ColumnNotFoundError: "id_right" not found
- `fin_012`: compile_error. unterminated string literal (detected at line 12) (candidate.py, line 12)
- `agg_004`: compile_error. invalid syntax (candidate.py, line 1)
- `filter_009`: compile_error. invalid syntax (candidate.py, line 1)
- `filter_003`: compile_error. invalid syntax (candidate.py, line 1)
- `agg_002`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_001`: compile_error. invalid character '—' (U+2014) (candidate.py, line 12)
- `filter_010`: runtime_error. TypeError: the truth value of an Expr is ambiguous  You probably got here by using a Python standard library function instead of the native expressions API. Here are some things you might want to try: - instead of `pl.col('a') and pl.col('b')`, use `
- `fin_004`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_019`: compile_error. invalid character '—' (U+2014) (candidate.py, line 10)

## Observaciones de esta corrida

- 12 respuestas de Capybara fallaron por omitir el punto y coma requerido tras la fuente.
- Algunas respuestas de Junie describen una solución sin entregar código: se conservaron y se contabilizaron como fallos, sin volver a solicitarlas.
- Respuestas descriptivas sin bloque de código detectadas: fin_017 (polars), fin_012 (polars), agg_004 (polars), filter_009 (polars), filter_003 (polars), agg_002 (polars), fin_001 (polars), fin_004 (polars), map_005 (capybara), fin_019 (polars).
- El caso original `str_003` usa las secuencias literales `\t` y `\n` en el JSON (barras escapadas), pero espera eliminarlas como si fueran caracteres de espacio en blanco. El resultado conserva la referencia original; conviene revisar esta inconsistencia del corpus antes de atribuir ese fallo al lenguaje.

## Alcance

Estos resultados corresponden a esta versión de los prompts y de Junie. Junie puede hacer varias llamadas internas por respuesta; no representan una llamada directa al modelo ni una comparación de velocidad de ejecución. Las respuestas no se corrigieron y los tests no se mostraron al generador. El criterio de corrección usa las salidas esperadas del corpus original de Anka. Una muestra por tarea no mide la variabilidad entre intentos.
