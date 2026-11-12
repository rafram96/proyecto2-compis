# Primer programa y recorrido de Studio

## Elegir y abrir una copia

Si es tu primera vez, el tutorial [De un CSV a un resultado](/docs/tutorial) recorre un programa completo, desde el archivo de datos hasta el archivo de salida, con un CSV incluido que no requiere preparación. Para practicar con Studio, comienza por [Ventas por cliente](/ejemplos/ventas). Lee el problema, el código y los requisitos. Abrir una copia en Studio crea un documento independiente con nombre, revisión 1, inspector Resultado y pases predeterminados. El documento anterior queda en Borradores anteriores. Navegar por ejemplos o documentación no modifica tu documento.

## Compilar e inspeccionar

Pulsa Compile o Ctrl/⌘ + Enter. La primera vez se descarga Python mediante Pyodide en un worker; necesitas conexión para esa carga. Después, las ediciones se analizan tras una pausa breve. Resultado, Tokens, Parse tree, AST, Flow, IR, Schemas y Python muestran distintas fases del mismo análisis. Cambiar de inspector no solicita otra compilación.

Compile no lee datasets ni certifica sus valores. El análisis sigue siendo local aunque el servicio esté desconectado. Ejecutar es una acción explícita distinta: envía el fuente y las opciones al servicio privado Python, que vuelve a compilar y valida datos reales con Polars. El Python descargado también puede ejecutarse con etl_dsl y Polars instalados. Sus rutas SOURCE/SINK pertenecen a ese entorno; el servicio web las resuelve mediante bindings autorizados y archivos propios del trabajo.

## Sugerencias mientras escribes

Al escribir aparece una lista de sugerencias; Ctrl + Espacio (en macOS también Option + I) la abre en cualquier punto. Recórrela con las flechas, acepta con Intro y ciérrala con Esc. Lo que propone depende de dónde está el cursor y sale del último análisis sin errores de tu documento:

- dentro de un STEP, las columnas que le llegan por FLOW, con sus tipos posibles y si pueden ser NULL; en `ON` de un JOIN, primero `left.` o `right.` y después las columnas de ese lado;
- en FLOW, las declaraciones que pueden enviar o recibir datos en esa posición, incluidos `joined.left`, `joined.right` y los INPUT/OUTPUT del pipeline que usa cada USE; tras `USE`, los demás pipelines;
- tras `SOURCE nombre =` o `SINK nombre =`, los conectores admitidos y, dentro de sus paréntesis, sus opciones (`mode` de DUCKDB solo en SINK; SQLITE solo en SOURCE); funciones y agregaciones muestran cuántos argumentos aceptan.

El encabezado de la lista indica de qué análisis salen. «Análisis vigente» significa que corresponde exactamente al texto; «Último análisis válido · revisión N» significa que escribiste después o que la versión actual tiene errores, así que una columna o un paso nuevos aparecerán cuando el documento vuelva a compilar sin errores. Si una fuente no declara contrato, el esquema es parcial: solo se proponen las columnas que el análisis conoce y la lista lo indica; nunca se inventan nombres. Pedir sugerencias no compila ni cambia el documento.

Si un diagnóstico E_COLUMN se parece a una columna conocida, debajo aparece «¿Quisiste decir?» con la columna propuesta; pulsarla sustituye exactamente el nombre señalado y se puede deshacer con Ctrl/⌘ + Z. El mensaje del diagnóstico no cambia.

## Ejecutar y consultar resultados

Con el servicio conectado, ve a Resultados, elige el pipeline ventas y enlaza ventas.pedidos con orders@1. Pulsa Run para enviar el programa. Si el dataset aparece sin preparar, ejecuta `python -m service.prepare` en el servidor y reinicia el servicio. JOIN y el tutorial utilizan datasets incluidos; ventas, riesgo y rangos requieren preparación. La compilación no realiza esa preparación.

El trabajo pasa por En cola y Ejecutando hasta Completado, Fallido, Cancelado o Tiempo agotado. Cancelar ejecución termina el proceso hijo. En Completado puedes elegir la salida, consultar una página de hasta 100 filas, desplegar su esquema y descargar el archivo completo. Una salida de cero filas es válida. OUTPUT se materializa en Parquet; SINK conserva su formato. Los contratos dinámicos de JOIN permanecen con O0 y con optimización.

Cada resultado muestra la revisión, pases y bindings enviados. Editar o cambiar opciones marca el resultado anterior; no ejecuta de nuevo. Navegar conserva la referencia del trabajo en memoria de esta pestaña y el sondeo se detiene al salir u ocultarla. Recargar conserva el documento pero pierde la referencia al trabajo. Los archivos caducan en el servidor a los 60 minutos; no se guardan tablas ni datasets en localStorage.

## Corregir y comparar

Abre [el ejercicio de NULL](/ejemplos/corregir-nulos). Compila, pulsa E_NULL_COMPARISON y cambia `status == NULL` por `status IS NULL`. El diagnóstico selecciona el intervalo en el editor, también desde el inspector móvil. Vuelve a compilar para obtener Python de la revisión actual.

Predeterminados usa `constantes,rangos,filtros,joins,muertos`; Sin pases (O0) conserva el análisis estático y desactiva todos los pases. La IR permite leer el antes y el después. [Rangos](/ejemplos/rangos) y [JOIN verificado](/ejemplos/join-verificado) explican qué puede cambiar y qué controles permanecen en ejecución.

## Conservar y recuperar

Puedes consultar estas guías y volver con Studio o con Atrás. Texto, nombre, revisión, pases e inspector permanecen en el documento. Los resultados se vinculan a su revisión; al volver puede ser necesario compilar de nuevo. No se guardan resultados, cursor ni historial de deshacer.

Borradores anteriores permite recuperar, descargar o eliminar un documento. El límite es de ocho anteriores, 128 KiB por documento y 512 KiB totales. Al llegar a ocho, abrir otra copia se bloquea hasta que elimines uno; no se expulsa ninguno automáticamente.

El almacenamiento es local a este navegador y origen. Si falla por cuota o permisos, aparece Sin guardar: el documento sigue en memoria. Descarga el .etl antes de cerrar o recargar. No hay sincronización remota. Descargar Python solo está disponible cuando corresponde a la revisión y pases actuales.


## Explorar el programa visualmente

**Parse tree** dibuja las reglas reconocidas por la gramática. Usa + para abrir una rama, los controles de zoom para ajustar la escala y el desplazamiento para recorrer el dibujo. La vista textual completa sigue disponible. Este artefacto no publica posiciones: para seleccionar un rango usa Tokens o AST.

**AST** resume el programa en declaraciones y expresiones. Elige un pipeline, abre sus ramas y pasa el cursor o el foco por un nodo: el código correspondiente se resalta sin modificar la selección. Un clic selecciona su intervalo original. El detalle explica el nodo y muestra sus propiedades. «Explorar propiedades del AST» mantiene la jerarquía textual completa, y JSON conserva las posiciones. Los grafos grandes se limitan de forma explícita para mantener la navegación fluida.

**Tokens** permite buscar un lexema o tipo, filtrar por categoría y recorrer páginas de 80 elementos. El número conserva el orden original y la ubicación selecciona el token exacto. Una búsqueda sin coincidencias indica cómo recuperarse.

**Flow** muestra las fuentes, pasos y destinos conectados por flechas, incluidos los puertos de JOIN y USE. «Lista de pasos» ofrece las mismas declaraciones en texto; la lista de conexiones indica su recorrido. Cambiar de pipeline, ajustar zoom o abrir ramas no recompila.

**IR** compara el plan original con el optimizado. Rojo y − marcan líneas retiradas; verde y +, añadidas. Las columnas permanecen alineadas incluso en pantallas estrechas: desplaza la tabla horizontalmente. «Solo nodos con cambios» oculta los conservados. La procedencia `origin` sigue determinando la correspondencia; una fusión puede aparecer relacionada con varios nodos originales. Las marcas no atribuyen cambios a pases sin evidencia. O0 no inventa diferencias. Los valores enteros fuera del rango seguro se consultan en la IR textual exacta.

Hover y foco solo previsualizan rangos de resultados vigentes. Una salida desactualizada no puede seleccionar ni resaltar código de una revisión nueva. La previsualización no desplaza automáticamente el editor ni cambia su cursor.

## Crear un pipeline con Blocks

En Studio, pulsa **Blocks**. Añade transformaciones con la paleta: filtrar, elegir columnas, calcular una columna numérica, agrupar y resumir, ordenar, quitar duplicados o retirar filas con NULL. Los bloques se conectan en orden; Subir/Bajar permite reorganizarlos con teclado o pantalla táctil. Si una columna deja de existir después de un cambio de orden, el constructor lo indica y bloquea la apertura hasta corregirlo.

La entrada inicial usa las columnas `cliente: INT` e `importe: DECIMAL` del CSV incluido `demo/joins_pedidos.csv`. Puedes editar el contrato y las rutas CSV. Los nombres y valores se validan antes de generar la copia; las cadenas se escapan como JSON. La vista previa muestra el DSL en todo momento.

**Abrir como copia en Code** conserva tu documento anterior en Borradores anteriores y abre el programa generado con una identidad nueva. Pulsa **Compile** para analizarlo con el compilador real; después puedes ejecutar con **Run** y el dataset autorizado `join-orders@1` para `mi_pipeline.datos`. También puedes descargar el `.etl`. No hay ejecución automática.

El alcance es intencional: pipelines lineales CSV, hasta 24 transformaciones y 32 columnas de entrada. JOIN, USE, ramificaciones y expresiones libres se escriben en Code. Blocks no convierte un programa arbitrario a bloques. El borrador visual permanece al alternar Code/Blocks durante esta visita, pero no se recupera al recargar; guarda una copia o descarga el programa antes de salir.
