# Benchmark de generación con Junie

- Inicio: 2026-11-15T23:59:08.716011+00:00
- Alias: `junie-lite`; modelo informado: Qwen/Qwen3.6-27B-FP8.
- Tareas seleccionadas: 60 de 80; exclusiones registradas: 20.
- Una respuesta por tarea y lenguaje; sesiones nuevas y sin feedback de tests.
- Comparación: Capybara frente a Python con biblioteca estándar.
- Generaciones: 120/120; corrida completa: True.
- Muestras emparejadas entre lenguajes: True.
- Intentos de herramientas externas bloqueados: 0.

| Lenguaje | Respuestas | Sintaxis válida | Pasan todos los tests | Exactitud |
|---|---:|---:|---:|---:|
| capybara | 60 | 42 | 38 | 63.3% |
| python | 60 | 56 | 50 | 83.3% |

## Resultados por categoría

| Categoría | Capybara | Python |
|---|---:|---:|
| aggregate | 7/10 | 9/10 |
| filter | 4/9 | 9/9 |
| finance | 15/18 | 13/18 |
| hard | 7/8 | 8/8 |
| map | 3/4 | 4/4 |
| multi_step | 0/8 | 5/8 |
| strings | 2/3 | 2/3 |

## Fallos

### capybara

compile_error: 21, wrong_output: 1

- `multi_004`: compile_error. E_SYNTAX: Símbolo inesperado: "AS"; se esperaba: ",", ";"
- `map_001`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `filter_002`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_005`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `multi_010`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: id y id.
- `agg_004`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `multi_006`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `agg_009`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `fin_012`: compile_error. E_SYNTAX: Símbolo inesperado: "Capybara"; se esperaba: "PIPELINE"
- `fin_001`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `fin_017`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `filter_004`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `str_003`: wrong_output.
- `filter_010`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `agg_006`: compile_error. E_SYNTAX: Símbolo inesperado: "AGGREGATE"; se esperaba: ";", "="
- `filter_006`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_003`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_001`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_002`: compile_error. E_SYNTAX: Símbolo inesperado: "DERIVE"; se esperaba: ";", "="
- `hard_004`: compile_error. E_AMBIGUOUS_COLUMNS: Nombres de salida ambiguos: product_id y product_id.
- `filter_005`: compile_error. E_SYNTAX: Símbolo inesperado: "FILTER"; se esperaba: ";", "="
- `multi_007`: compile_error. E_SYNTAX: Símbolo inesperado: "RENAME"; se esperaba: ";", "="

### python

compile_error: 4, wrong_output: 6

- `multi_004`: compile_error. invalid syntax (candidate.py, line 1)
- `fin_012`: wrong_output.
- `str_001`: wrong_output.
- `fin_005`: wrong_output.
- `multi_006`: wrong_output.
- `agg_006`: compile_error. invalid syntax (candidate.py, line 1)
- `multi_002`: wrong_output.
- `fin_008`: compile_error. invalid character '—' (U+2014) (candidate.py, line 10)
- `fin_019`: compile_error. invalid character '—' (U+2014) (candidate.py, line 9)
- `fin_014`: wrong_output.

## Observaciones de esta corrida

- 16 respuestas de Capybara fallaron por omitir el punto y coma requerido tras la fuente.
- Algunas respuestas de Junie describen una solución sin entregar código: se conservaron y se contabilizaron como fallos, sin volver a solicitarlas.
- Respuestas descriptivas sin bloque de código detectadas: multi_004 (python), fin_012 (capybara), agg_006 (python), fin_008 (python), fin_019 (python).
- El caso original `str_003` usa las secuencias literales `\t` y `\n` en el JSON (barras escapadas), pero espera eliminarlas como si fueran caracteres de espacio en blanco. El resultado conserva la referencia original; conviene revisar esta inconsistencia del corpus antes de atribuir ese fallo al lenguaje.

## Alcance

Estos resultados corresponden a esta versión de los prompts y de Junie. Junie puede hacer varias llamadas internas por respuesta; no representan una llamada directa al modelo ni una comparación de velocidad de ejecución. Las respuestas no se corrigieron y los tests no se mostraron al generador. El criterio de corrección usa las salidas esperadas del corpus original de Anka. Una muestra por tarea no mide la variabilidad entre intentos.
