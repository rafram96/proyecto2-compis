# Primer programa y recorrido dStudio

## Elegir y abrir una copia

Si es tu primera vez, el tutorial [De un CSV a un resultado](/docs/tutorial) recorre un programa completo, desde el archivo de datos hasta el archivo de salida, con un CSV incluido que no requiere preparación. Para practicar con Studio, comienza por [Ventas por cliente](/ejemplos/ventas). Lee el problema, el código y los requisitos. Abrir una copia en Studio crea un documento independiente con nombre, revisión 1, inspector Resultado y pases predeterminados. El documento anterior queda en Borradores anteriores. Navegar por ejemplos o documentación no modifica tu documento.

## Compile e inspeccionar

Pulsa Compile o Ctrl/⌘ + Enter. La primera vez se descarga Python mediante Pyodide en un worker; necesitas conexión para esa carga. Después, las ediciones se analizan tras una pausa breve. Resultado, Tokens, Árbol, AST, IR y Python muestran fases textuales del mismo análisis. Cambiar de inspector no solicita otra compilación.

Compile no lee datasets ni certifica sus valores. El análisis sigue siendo local aunque el servicio esté desconectado. Ejecutar es una acción explícita distinta: envía el fuente y las opciones al servicio privado Python, que vuelve a compilar y valida datos reales con Polars. El Python descargado también puede ejecutarse con etl_dsl y Polars instalados. Sus rutas SOURCE/SINK pertenecen a ese entorno; el servicio web las resuelve mediante bindings autorizados y archivos propios del trabajo.

## Sugerencias mientras escribes

Al escribir aparece una lista de sugerencias; Ctrl + Espacio (en macOS también Option + I) la abre en cualquier punto. Recórrela con las flechas, acepta con Intro y ciérrala con Esc. Lo que propone depende de dónde está el cursor y sale del último análisis sin errores de tu documento:

- dentro de un STEP, las columnas que le llegan por FLOW, con sus tipos posibles y si pueden ser NULL; en `ON` de un JOIN, primero `left.` o `right.` y después las columnas de ese lado;
- en FLOW, las declaraciones que pueden enviar o recibir datos en esa posición, incluidos `joined.left`, `joined.right` y los INPUT/OUTPUT del pipeline que usa cada USE; tras `USE`, los demás pipelines;
- tras `SOURCE nombre =` o `SINK nombre =`, los conectores admitidos y, dentro de sus paréntesis, sus opciones (`mode` de DUCKDB solo en SINK; SQLITE solo en SOURCE); funciones y agregaciones muestran cuántos argumentos aceptan.

El encabezado de la lista indica de qué análisis salen. «Análisis vigente» significa que corresponde exactamente al texto; «Último análisis válido · revisión N» significa que escribiste después o que la versión actual tiene errores, así que una columna o un paso nuevos aparecerán cuando el documento vuelva a compilar sin errores. Si una fuente no declara contrato, el esquema es parcial: solo se proponen las columnas que el análisis conoce y la lista lo indica; nunca se inventan nombres. Pedir sugerencias no compila ni cambia el documento.

Si un diagnóstico E_COLUMN se parece a una columna conocida, debajo aparece «¿Quisiste decir?» con la columna propuesta; pulsarla sustituye exactamente el nombre señalado y se puede deshacer con Ctrl/⌘ + Z. El mensaje del diagnóstico no cambia.

## Ejecutar y consultar resultados

Con el servicio conectado, ve a Resultados, elige el pipeline ventas y enlaza ventas.pedidos con orders@1. Pulsa Ejecutar para enviar el programa. Si el dataset aparece sin preparar, ejecuta `python -m service.prepare` en el servidor y reinicia el servicio. JOIN y el tutorial utilizan datasets incluidos; ventas, riesgo y rangos requieren preparación. La compilación no realiza esa preparación.

El trabajo pasa por En cola y Ejecutando hasta Completado, Fallido, Cancelado o Tiempo agotado. Cancelar ejecución termina el proceso hijo. En Completado puedes elegir la salida, consultar una página de hasta 100 filas, desplegar su esquema y descargar el archivo completo. Una salida de cero filas es válida. OUTPUT se materializa en Parquet; SINK conserva su formato. Los contratos dinámicos de JOIN permanecen con O0 y con optimización.

Cada resultado muestra la revisión, pases y bindings enviados. Editar o cambiar opciones marca el resultado anterior; no ejecuta de nuevo. Navegar conserva la referencia del trabajo en memoria de esta pestaña y el sondeo se detiene al salir u ocultarla. Recargar conserva el documento pero pierde la referencia al trabajo. Los archivos caducan en el servidor a los 60 minutos; no se guardan tablas ni datasets en localStorage.

## Corregir y comparar

Abre [el ejercicio de NULL](/ejemplos/corregir-nulos). Compila, pulsa E_NULL_COMPARISON y cambia `status == NULL` por `status IS NULL`. El diagnóstico selecciona el intervalo en el editor, también desde el inspector móvil. Vuelve a compilar para obtener Python de la revisión actual.

Predeterminados usa `constantes,rangos,filtros,joins,muertos`; Sin pases (O0) conserva el análisis estático y desactiva todos los pases. La IR permite leer el antes y el después. [Rangos](/ejemplos/rangos) y [JOIN verificado](/ejemplos/join-verificado) explican qué puede cambiar y qué controles permanecen en ejecución.

## Conservar y recuperar

Puedes consultar estas guías y volver con Studio o con Atrás. Texto, nombre, revisión, pases e inspector permanecen en el documento. Los resultados se vinculan a su revisión; al volver puede ser necesario compilar de nuevo. No se guardan resultados, cursor ni historial de deshacer.

Borradores anteriores permite recuperar, descargar o eliminar un documento. El límite es de ocho anteriores, 128 KiB por documento y 512 KiB totales. Al llegar a ocho, abrir otra copia se bloquea hasta que elimines uno; no se expulsa ninguno automáticamente.

El almacenamiento es local a este navegador y origen. Si falla por cuota o permisos, aparece Sin guardar: el documento sigue en memoria. Descarga el .etl antes de cerrar o recargar. No hay sincronización remota. Descargar Python solo está disponible cuando corresponde a la revisión y pases actuales.
