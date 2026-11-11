# API de análisis compartida (C1/C2)

La CLI, el puente web y el generador de demostraciones usan la API pública `etl_dsl.analyze`. Recibe texto en memoria, sin crear un `.etl` temporal, leer conectores, ejecutar Python generado ni importar Polars/DuckDB.

```python
import json
from etl_dsl import analyze

result = analyze(
    source,
    filename="ventas.etl",   # Nombre lógico para los diagnósticos.
    base_dir=".",           # Base incorporada al Python generado.
    passes=None,            # Predeterminados; () desactiva todos los pases.
    artifacts=("ast", "ir_before", "ir_after", "python"),
)
payload = result.to_dict()
print(json.dumps(payload, ensure_ascii=False))
```

`artifacts=None` solicita todos; `artifacts=()` solo valida léxico, sintaxis, estructura y semántica. La selección evita serializar artefactos innecesarios y ejecutar pases o generación cuando no se necesitan; la IR original se construye siempre para el análisis semántico. Los prerrequisitos internos se calculan aunque no se solicite su representación.

Los nombres válidos son `tokens`, `tree`, `ast`, `ir_before`, `ir_after`, `python` y `schemas`. Los errores de opciones del llamador lanzan `ValueError`. Los errores del programa se devuelven en `diagnostics`; las excepciones inesperadas de implementación no se ocultan como errores del usuario.

## Contrato JSON versión 2

| Campo | Significado |
|---|---|
| `contract_version` | Versión del contrato de análisis (`"2"`). No es una versión HTTP. |
| `compiler_version` | Versión del paquete compilador. |
| `offset_encoding` | `unicode-codepoints`: offsets y columnas medidos en caracteres Unicode de Python. |
| `filename` | Nombre lógico recibido; puede contener rutas o `:` y no se interpreta para abrir un archivo. |
| `source_hash` | SHA-256 del texto UTF-8 exacto, útil para asociar el resultado al documento. |
| `ok` | No hay diagnósticos de severidad `error` en las fases realizadas. |
| `pipeline_count` | Cantidad de pipelines si se construyó el AST; `null` en caso contrario. |
| `passes` | Pases seleccionados y orden solicitado. |
| `applied_passes` | Pases ejecutados sobre IR; vacío si no se optimizó o con `-O0`. |
| `diagnostics` | Lista de objetos con `phase`, `severity`, `code`, `message`, `filename`, `span`. |
| `artifacts` | Entradas para los siete artefactos, cada una con `status` y `data`. |

Los estados son `not_requested`, `available` y `blocked`. En los dos estados sin datos, `data` es `null`; no se representa un fallo con un AST o una tabla ficticios.

Un `ok=true` al solicitar solo AST o validación **no certifica generación de Python ni ejecución**. El verificador comprueba estructura, esquemas, tipos y nulabilidad de forma conservadora; el conocimiento desconocido no certifica validez de los datos. Los conectores que solo comprueba el backend se validan al solicitar Python, como en la CLI existente.

## Datos y errores por fase

- `tokens`: lista JSON de tokens, lexemas y posiciones, usando el scanner básico de inspección. El parser mantiene su lexer contextual.
- `tree`: árbol concreto de Lark en texto.
- `ast`: AST completo, con posiciones y etiquetas `node`. Los decimales se mantienen como texto para no perder precisión.
- `ir_before` y `ir_after`: `{module, text}`; el módulo incluye pipelines, nodos, entradas, payload y procedencia `origin`. Las expresiones conservan su estructura y posiciones.
- `python`: código generado como texto.
- `schemas`: esquemas de la IR original, como `pipeline -> nodo -> puerto -> {complete, absent, columns}`. El puerto ordinario se representa con `""`; USE tiene puertos nombrados. Cada columna incluye `name`, `types` (lista de tipos posibles o `null` si desconocido) y `nullable`. `types=[]` significa dtype Null. Con `complete=false`, el conjunto de columnas y sus posiciones siguen siendo parciales. Las reglas completas están en [semantica_estatica.md](semantica_estatica.md).

Si falla el léxico, no hay una lista de tokens completa. Si falla la sintaxis, los tokens solicitados siguen disponibles; árbol y AST quedan bloqueados. Si falla la validación estructural, se conservan árbol y AST solicitados y se bloquea IR. Si falla el análisis estático, se conserva también la IR original solicitada; los esquemas, la IR optimizada y Python quedan bloqueados, con diagnósticos `semantic`. Si falla la generación, se conserva la IR disponible y el diagnóstico lleva fase `backend`. No se realiza recuperación sintáctica de múltiples errores; sí se devuelven los múltiples diagnósticos de validación existentes.

`span` contiene `line`, `column`, `end_line`, `end_column`, `start` y `end`. Líneas/columnas empiezan en 1; offsets empiezan en 0 y el final es exclusivo. El fin de archivo tiene intervalo vacío. CodeMirror usa UTF-16: el adaptador web debe convertir las columnas Unicode, especialmente si hay emoji antes del error.

## Presentación y adaptadores

`etl_dsl.analysis.artifacts_for_format(fmt)` selecciona los artefactos para `check`, `tokens`, `tree`, `ast`, `ir` y `python`. `format_output(result, fmt)` conserva los formatos de texto de la CLI y puede mostrar un artefacto disponible de un análisis parcial. `format_diagnostics(result, source)` produce el texto de consola; la web recibe los diagnósticos como objetos.

La CLI conserva sus flags, archivos de salida y códigos de retorno. La vista compacta de la web puede ocultar posiciones del AST, pero el contrato conserva los intervalos originales. Los nombres de archivos del puente son lógicos: compilar `carpeta/programa.etl` no crea ni sobrescribe ese archivo.

Los snapshots de `web/src/data/compiled.json` son presentaciones precalculadas, con texto y resumen del análisis, no instancias completas del contrato: omiten `artifacts` para no duplicar los árboles dentro del paquete inicial. El resultado en vivo del worker entrega el contrato completo. La presentación web de Python normaliza la ruta base a `'.'`, tanto en el texto como en el artefacto, para mantener paridad entre CPython y Pyodide.

## Verificación de C1

- `.venv/bin/python -m unittest discover`: 70 pruebas Python, incluyendo selección de artefactos, errores parciales, ausencia de IO y paridad CLI/puente.
- `cd web && npm test`: 4 pruebas de conversión de rangos Unicode, multilineales y EOF.
- `cd web && npm run build`: comprobación TypeScript y build de producción.
- Con Vite iniciado, `.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5173/`: prueba mediante `playwright-cli` del compilador real en WASM, 32 comparaciones con snapshots CPython y recorrido de corrección de errores en CodeMirror. Este verificador requiere el servidor de desarrollo porque inspecciona los módulos del cliente.

## Migración de versión 1 a 2

La versión 2 agrega el artefacto seleccionable `schemas` y ejecuta C2 en todas las
selecciones, incluido `check`, antes de los pases. Conserva los campos y formatos
de presentación existentes. Los consumidores deben aceptar la versión `"2"` y
la nueva clave de artefactos; los tipos web y snapshots se actualizan juntos. Los
errores de columnas, calificadores y tipos antes diferidos al backend/runtime
pueden aparecer ahora en `semantic`, con IR original disponible.

Verificación C2: 88 pruebas Python, 4 pruebas web, build de producción y prueba
Pyodide con `playwright-cli`: 32 comparaciones CPython/WASM, dos casos C2 con
intervalos y artefactos parciales, corrección en CodeMirror y rangos Unicode.
