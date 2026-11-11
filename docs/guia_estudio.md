# Primer programa y recorrido del estudio

## Elegir y abrir una copia

Comienza por [Ventas por cliente](/ejemplos/ventas). Lee el problema, el código y los requisitos. Abrir una copia en el estudio crea un documento independiente con nombre, revisión 1, inspector Resultado y pases predeterminados. El documento anterior queda en Borradores anteriores. Navegar por ejemplos o documentación no modifica tu documento.

## Compilar e inspeccionar

Pulsa Compilar o Ctrl/⌘ + Enter. La primera vez se descarga Python mediante Pyodide en un worker; necesitas conexión para esa carga. Después, las ediciones se analizan tras una pausa breve. Resultado, Tokens, Árbol, AST, IR y Python muestran fases textuales del mismo análisis. Cambiar de inspector no solicita otra compilación.

Compilar no lee datasets ni certifica sus valores. La web no ejecuta Polars ni muestra filas de resultados. El Python generado requiere el entorno del proyecto con etl_dsl y Polars instalado. Las rutas SOURCE y SINK corresponden a ese entorno, no al equipo desde el navegador.

## Corregir y comparar

Abre [el ejercicio de NULL](/ejemplos/corregir-nulos). Compila, pulsa E_NULL_COMPARISON y cambia `status == NULL` por `status IS NULL`. El diagnóstico selecciona el intervalo en el editor, también desde el inspector móvil. Vuelve a compilar para obtener Python de la revisión actual.

Predeterminados usa `constantes,rangos,filtros,joins,muertos`; Sin pases (O0) conserva el análisis estático y desactiva todos los pases. La IR permite leer el antes y el después. [Rangos](/ejemplos/rangos) y [JOIN verificado](/ejemplos/join-verificado) explican qué puede cambiar y qué controles permanecen en ejecución.

## Conservar y recuperar

Puedes consultar estas guías y volver con Estudio o con Atrás. Texto, nombre, revisión, pases e inspector permanecen en el documento. Los resultados se vinculan a su revisión; al volver puede ser necesario compilar de nuevo. No se guardan resultados, cursor ni historial de deshacer.

Borradores anteriores permite recuperar, descargar o eliminar un documento. El límite es de ocho anteriores, 128 KiB por documento y 512 KiB totales. Al llegar a ocho, abrir otra copia se bloquea hasta que elimines uno; no se expulsa ninguno automáticamente.

El almacenamiento es local a este navegador y origen. Si falla por cuota o permisos, aparece Sin guardar: el documento sigue en memoria. Descarga el .etl antes de cerrar o recargar. No hay sincronización remota. Descargar Python solo está disponible cuando corresponde a la revisión y pases actuales.
