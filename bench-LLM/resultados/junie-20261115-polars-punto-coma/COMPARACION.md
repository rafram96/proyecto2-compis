# Comparación de corridas

- Anterior: `junie-20261115-polars`.
- Actual: `junie-20261115-polars-punto-coma`.
- Modelos informados: anterior ['Qwen/Qwen3.6-27B-FP8']; actual ['Qwen/Qwen3.6-27B-FP8'].
- Mismas tareas y referencias; respuestas nuevas por cada lenguaje.

| Medida | Anterior | Actual |
|---|---:|---:|
| Capybara: respuestas correctas | 42/60 (70.0%) | 50/60 (83.3%) |
| Capybara: sintaxis válida | 46/60 | 54/60 |
| Python con Polars: respuestas correctas | 48/60 (80.0%) | 41/60 (68.3%) |
| Python con Polars: sintaxis válida | 51/60 | 44/60 |
| Capybara: errores por omitir `;` tras la fuente | 12 | 0 |

## Condiciones

- Plantilla de Capybara: modificada.
- Plantilla de Python con Polars: idéntica.
- Los programas generados no se corrigieron ni se reintentaron por fallar los tests.
- El énfasis en el punto y coma se añadió después de observar la corrida anterior.
- Esta comparación usa una muestra por tarea y lenguaje. Las diferencias observadas no aíslan la variabilidad del modelo ni constituyen una validación independiente.
