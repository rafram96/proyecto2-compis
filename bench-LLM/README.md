# Generación de código con LLMs

Compara CaPybara con **Python usando Polars** sobre tareas del benchmark de
[Anka](https://github.com/BleBlo/Anka/tree/540128d90b74c125eb5881f7bb42246d2e89bc7e).
Evalúa si los programas generados producen el resultado esperado; los benchmarks
de rendimiento con TPC-H permanecen en [`../bench/`](../bench/README.md).

## Resultados versionados

Junie Lite informó el modelo `Qwen/Qwen3.6-27B-FP8`. Cada corrida completa contiene
una respuesta por tarea y lenguaje: 60 × 2 = 120 programas.

| Corrida | CaPybara | Comparador | Omisiones de `;` en CaPybara |
|---|---:|---:|---:|
| [Python puro, guía inicial](resultados/junie-20261115-final/RESUMEN.md) | 38/60 (63,3 %) | 50/60 (83,3 %) | 16 |
| [Polars, guía inicial](resultados/junie-20261115-polars/RESUMEN.md) | 42/60 (70 %) | 48/60 (80 %) | 12 |
| [Polars, guía reforzada](resultados/junie-20261115-polars-punto-coma/RESUMEN.md) | 50/60 (83,3 %) | 41/60 (68,3 %) | 0 |

La [comparación de las dos corridas con Polars](resultados/junie-20261115-polars-punto-coma/COMPARACION.md)
registra el cambio de guía: una regla destacada, ejemplos y revisión textual del
`;` después de `FROM ... AS TABLE[...]`. El prompt de Polars se mantuvo idéntico.
La guía previa está en `prompts/historico/capybara_v1.md` y en las solicitudes guardadas.

Los resultados son **exploratorios**: una muestra por tarea y lenguaje, un modelo
y un prompt ajustado después de observar errores del mismo corpus. Incluyen los
casos en que Junie describe una solución sin entregar código válido. No se corrigen
programas ni se vuelven a solicitar respuestas por fallar los tests. La variación de
Polars con el mismo prompt limita las conclusiones sobre superioridad de un lenguaje.
Además, el caso original `str_003` contiene escapes literales cuya referencia
elimina como espacios: se conserva la inconsistencia, documentada en los resúmenes.

## Origen y cobertura

`upstream/` conserva únicamente las **80 tareas** de `benchmarks/tasks/`, la
metodología original, el README de Anka y su licencia MIT. `UPSTREAM.json` fija el
commit y los SHA-256 de esos **83 archivos**. No se incluyen los ejecutores ajenos,
las figuras de Anka ni el corpus alternativo `problems/`.

Las categorías son aggregate (10), filter (10), finance (20), hard (10), map (10),
multi_step (10) y strings (10). Se seleccionan **60 tareas sin incompatibilidades
conocidas**; 20 exclusiones se registran antes de generar respuestas porque requieren
LIMIT, UNION, IF, ROUND u otras funciones ausentes en CaPybara. La lista está en
`UNSUPPORTED` de `benchmark.py`. Esto clasifica capacidades; no presupone aciertos.
No se modifican los enunciados, datos ni salidas esperadas originales.

Para reimportar en una copia que todavía no tenga `upstream/`:

```bash
python bench-LLM/importar_anka.py
```

## Preparar prompts

Desde la raíz del proyecto, con Python 3.11 o posterior:

```bash
python -m pip install -e .
python bench-LLM/benchmark.py preparar --baseline polars
```

Se crean `preparado/manifest.json`, `preparado/prompts.jsonl` y un Markdown por tarea
y lenguaje. El manifiesto contiene selección, exclusiones y hashes de las plantillas.
La guía actual enfatiza el terminador obligatorio de `FROM`. Los prompts incluyen
esquemas, contrato de ejecución y ejemplos ajenos a las tareas; no incluyen tests,
datos concretos ni salidas esperadas. Preparar prompts no realiza llamadas al modelo.

```bash
python bench-LLM/benchmark.py preparar --tareas multi_001 --salida bench-LLM/preparado-demo-polars
python bench-LLM/benchmark.py preparar --categorias multi_step finance
python bench-LLM/benchmark.py preparar --incluir-no-soportadas --salida bench-LLM/preparado-completo
```

`--baseline python` conserva el protocolo histórico de biblioteca estándar.

## Generar sin exponer el proyecto

La generación y la evaluación son etapas separadas. Para usar prompts manualmente,
exportar solo las solicitudes, en paquetes independientes:

```bash
python bench-LLM/benchmark.py exportar --lenguaje capybara --salida bench-LLM/generacion-capybara.zip
python bench-LLM/benchmark.py exportar --lenguaje polars --salida bench-LLM/generacion-polars.zip
```

Cada ZIP contiene `LEEME.md` y `solicitudes.jsonl`. En una sesión nueva por tarea y
muestra, enviar únicamente el campo `prompt`. Mantener separadas las sesiones de los
dos lenguajes y conservar la respuesta original. No proporcionar feedback de tests.
Cambiar de carpeta o usar un ZIP no restringe permisos: el generador debe carecer de
herramientas de archivos o ejecutarse en un entorno sin acceso al repositorio.

### Junie desde CMD en Windows

```powershell
python bench-LLM/junie_runner.py --preparado bench-LLM/preparado --model junie-lite --workers 2 --salida bench-LLM/resultados/mi-corrida --evaluar
```

Requiere Junie instalado y autenticado. Cada solicitud pasa por entrada estándar a
`cmd.exe` y abre una sesión en una carpeta temporal vacía fuera del repositorio.
Se desactiva el descubrimiento de configuraciones, MCP, skills, agentes, comandos y
extensiones. Un hook `PreToolUse` bloquea herramientas salvo `answer` y `submit`, con
fallo cerrado; un intento de usar otra herramienta se marca como error de generación.
Este control es de Junie, no un sandbox del sistema operativo.

El runner mantiene la validación TLS y usa los certificados de Windows solo en sus
subprocesos Java. No cambia la configuración global. Registra alias, modelo real,
sesión y uso informado por Junie. La CLI puede realizar varias llamadas internas por
respuesta y no expone la temperatura; se usan sus valores predeterminados.
El evaluador corre al terminar la generación, sin devolver diagnósticos al agente.

Un fallo del servicio detiene nuevos envíos. El conflicto local conocido del índice
de sesiones se reintenta una vez solamente si no hay respuesta ni uso del LLM
registrados. Para continuar en otra carpeta sin repetir programas ya generados:

```powershell
python bench-LLM/junie_runner.py --preparado bench-LLM/preparado --salida bench-LLM/resultados/continuacion --continuar-desde bench-LLM/resultados/mi-corrida --workers 2 --evaluar
```

## Evaluar respuestas guardadas

Una línea JSON por respuesta:

```json
{"task_id":"multi_001","language":"polars","sample":1,"model":"identificador-exacto","prompt_sha256":"hash-de-la-solicitud","code":"respuesta-original-del-modelo"}
```

Usar `capybara` o `polars`; `python` identifica únicamente el protocolo histórico.
Usar el mismo modelo, configuración y número de muestras en ambos lenguajes.

```bash
python bench-LLM/benchmark.py evaluar bench-LLM/respuestas.jsonl --manifiesto bench-LLM/preparado/manifest.json
```

CaPybara lee Parquet tipados y escribe `output.parquet`. La variante Polars recibe
las mismas tablas tipadas en `transform(data)` y debe importar Polars y retornar un
DataFrame o LazyFrame. La variante histórica recibe listas de diccionarios. El
import y el tipo de salida se comprueban; no prueban por sí solos que toda la lógica
interna esté implementada exclusivamente con expresiones Polars.

Cada programa se ejecuta en un subproceso y directorio temporal, con timeout
predeterminado de 10 segundos (`--timeout`). El runtime de CaPybara restringe sus rutas
al directorio del test; el subproceso no es una barrera de seguridad para Python
arbitrario. Usar un entorno desechable con respuestas externas.

Se comparan todos los tests de la tarea, con nombres de columnas y orden de filas
exactos y tolerancia numérica absoluta `1e-9`. Se preservan salidas esperadas vacías;
se extrae el primer bloque Markdown si existe, sin reparar programas. Los estados
son `passed`, `compile_error`, `runtime_error`, `wrong_output`, `contract_error`,
`generation_error`, `timeout` y `worker_error`. La exactitud se calcula sobre las
muestras recibidas, con tareas pendientes y emparejamiento registrados explícitamente.

## Evidencia y reproducción del reporte

Se versionan las tres corridas citadas: evaluaciones por test, respuestas originales,
prompts, manifiestos, parámetros, resúmenes y auditorías. Los directorios `raw/` con
logs completos y rutas locales, cachés, ZIP y prompts regenerables no se versionan.
Los pilotos e intentos interrumpidos se excluyen del corpus publicado.

```bash
python bench-LLM/resumir.py bench-LLM/resultados/junie-20261115-polars-punto-coma
python bench-LLM/auditar.py bench-LLM/resultados/junie-20261115-polars-punto-coma --solo-respuestas
python bench-LLM/comparar_corridas.py bench-LLM/resultados/junie-20261115-polars bench-LLM/resultados/junie-20261115-polars-punto-coma
python reporte/llm_v2.py
```

`--solo-respuestas` valida hashes, sesiones, pares y conservación de las respuestas
en la evaluación, y escribe `VERIFICACION.json`; no afirma revisar logs ausentes.
La auditoría completa, sin esa opción, requiere `raw/` y escribe `AUDITORIA.json`.
Las auditorías completas ya guardadas corresponden a las corridas originales.
El PDF y su fuente están en [`../reporte/`](../reporte/README.md).

## Prueba sin llamadas al LLM

```bash
python bench-LLM/benchmark.py preparar --baseline python --tareas multi_001 --salida bench-LLM/preparado-demo
python bench-LLM/benchmark.py evaluar bench-LLM/ejemplos/respuestas_demo.jsonl --manifiesto bench-LLM/preparado-demo/manifest.json --salida bench-LLM/resultados/demo.json
python -m unittest discover -s bench-LLM/tests -v
```

Las respuestas de `ejemplos/` están escritas a mano para comprobar integración; no
son resultados de un LLM. Las dependencias de la adaptación son las del compilador
(`lark`, `polars`) y la biblioteca estándar. Las herramientas del reporte requieren
además las dependencias de análisis indicadas en su README.
