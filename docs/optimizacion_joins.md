# Eliminación O3 de INNER JOIN con obligaciones verificables (C4)

C4 incorpora `VERIFY MANY_TO_ONE;` dentro de JOIN y el pase `joins`.
La garantía se declara sobre las entradas exactas de ese operador, después de
cualquier transformación. No declara integridad global de un dataset.

```text
STEP unidos = JOIN {
  TYPE INNER;
  ON left.cliente == right.clave;
  VERIFY MANY_TO_ONE;
}
STEP visibles = SELECT { COLUMNS cliente, importe; }
```

La cláusula es opcional. Sin ella no se elimina el JOIN. Solo se admite en
INNER con una igualdad simple; otros usos producen `E_JOIN_GUARANTEE`, diagnóstico
estructurado en español cuyo span identifica la cláusula. Las comprobaciones
C2 siguen ejecutándose sobre el programa original, también en `check` y `-O0`.
Un error de tipos conserva la IR original; un error estructural conserva el AST.
No se leen conectores ni se importa Polars durante compilación. El mismo núcleo
funciona en CPython y Pyodide sin dependencias nuevas.

## Declaración, prueba estática y obligación dinámica

Son tres cosas diferentes:

1. **Declaración:** el usuario exige `VERIFY MANY_TO_ONE`; no aporta una prueba
   de datos ni autoriza confiar en nombres o convenciones.
2. **Prueba estática:** ambos conjuntos de columnas deben ser completos según
   C2 y cada consumidor inmediato debe ser SELECT con columnas exclusivamente
   izquierdas. Se comprueban todos los consumidores del DAG, no solo la rama
   que termina en una salida particular. Ambas claves del JOIN son columnas
   observables porque el backend usa `coalesce=False`.
3. **Obligación dinámica:** antes de devolver cualquier salida del pipeline se
   comprueban tipos físicos iguales, claves no nulas, unicidad derecha y
   referencia total izquierda. Cada fila izquierda debe tener exactamente una
   coincidencia. Los contratos previos de ambas entradas también se ejecutan.

Un OUTPUT tipado comprueba nombres/orden/tipos; **no proyecta** columnas. OUTPUT
TABLE, SINK y USE directamente conectados al JOIN impiden la eliminación, al igual
que cualquier consumidor que no sea SELECT. Después de la frontera SELECT se
admiten todas las operaciones y contratos existentes: las columnas derechas ya
no pueden ser observadas. Una rama que selecciona la clave derecha impide la
reescritura aunque las otras ramas seleccionen únicamente columnas izquierdas.

## Ejecución efectiva y semántica de errores

`PolarsRuntime.verify_many_to_one` materializa ambas entradas completas, valida
las claves y devuelve LazyFrames sobre esas mismas instantáneas. No construye
un plan lazy de validación que el optimizador pueda descartar, ni vuelve a leer
las fuentes para calcular el resultado. Un cálculo derecho no proyectado sigue
materializándose y puede fallar. Los contratos SOURCE/INPUT/OUTPUT/USE y efectos
previos conservan su ejecución. La obligación se ejecuta incluso si el cliente
no llama a `collect()` sobre los OUTPUT o si el JOIN carece de consumidores.

La igualdad de pertenencia se evalúa mediante un anti join Polars sobre las
instantáneas y la unicidad con `n_unique`. No se convierte la clave a strings,
no se usa igualdad Python ni se fuerzan coerciones numéricas. Se exige el mismo
dtype físico (incluidos ancho, precisión/escala y unidades), aunque ambos tipos
satisfagan una familia DSL. El JOIN declarado conserva el orden izquierdo con
`maintain_order='left'`, también en -O0; así SORT, DISTINCT y los SINK reciben la
misma secuencia cuando el pase lo sustituye por su entrada izquierda.

| Situación | Comportamiento del contrato, con o sin optimización |
|---|---|
| Duplicados derechos | `E_JOIN_UNIQUE`, aunque la izquierda esté vacía. |
| Referencia izquierda ausente | `E_JOIN_REFERENCE`. |
| NULL en cualquier clave | `E_JOIN_NULL`, incluso con esquemas nullable o izquierda vacía. |
| Contrato previo no nullable incumplido | Se conserva su `E_NULL` anterior al JOIN. |
| Tipos físicos distintos | `E_JOIN_KEY_TYPE`; C2 puede rechazar antes una incompatibilidad conocida con `E_TYPE`. |
| Ambas entradas vacías con tipos válidos | Éxito; salida vacía con esquema izquierdo tras SELECT. |
| Izquierda vacía, derecha única y no nula | Éxito. |
| Derecha vacía, izquierda no vacía | `E_JOIN_REFERENCE`. |
| Duplicados izquierdos | Permitidos; se conserva su multiplicidad. |

NULL nunca coincide con NULL bajo este contrato. Una declaración nullable admite
el dato en su entrada, pero no satisface por sí sola la obligación del JOIN.
Los errores de ejecución usan `ExecutionError` con código y etiqueta/ubicación,
como los otros contratos del runtime; no se presentan como diagnósticos estáticos.

## IR, procedencia y pases

`joins` sustituye el nodo JOIN por `CHECK_JOIN`, manteniendo nombre, payload,
span, origin y ambas entradas. CHECK_JOIN entrega únicamente la tabla izquierda;
los SELECT consumidores conservan sus referencias y proyecciones. No se elimina
la dependencia derecha. `muertos` considera raíces tanto CHECK_JOIN como todo
JOIN con garantía explícita, incluso sin consumidores. Por ello los órdenes
`muertos,joins` y `joins,muertos` preservan las verificaciones.

`Module.join_rewrites` registra pipeline, nodo, acción, span/origin, consumidores
cuya entrada cambia de esquema, referencias conservada/eliminada, declaración y
span de la garantía, obligaciones dinámicas, prueba estática y lugar de
verificación. «Eliminada» designa el lado que deja de aportar columnas, no una
lectura eliminada. La IR textual también indica la reescritura y su verificación.
Los esquemas públicos `schemas` siguen describiendo el programa original.
El contrato JSON pasa a versión **4**, con AST de garantía y nuevo campo de IR;
se actualizan tipos TypeScript, pruebas y snapshots.

Orden predeterminado: `constantes,rangos,filtros,joins,muertos`. Se ubica después
de simplificar filtros y antes de quitar nodos muertos; se puede seleccionar
solo con `--pases joins`. `-O0` conserva el JOIN y **ejecuta la misma garantía**.
Rangos reconoce CHECK_JOIN y reinicia conservadoramente sus hechos con C2.
No se infieren unicidad/referencias a partir de intervalos ni se propagan esas
propiedades por FILTER, RENAME, DERIVE, SELECT, DISTINCT, AGGREGATE, JOIN o USE:
la obligación se verifica de nuevo en las entradas exactas de cada JOIN.
Esto evita reutilizar una referencia después de filtrar la tabla referenciada,
un duplicado introducido por otra operación o un cambio de comparación.

## Demo y verificación

Desde la raíz, con los CSV incluidos:

```sh
.venv/bin/python main.py demo/joins.etl --format ir
.venv/bin/python main.py demo/joins.etl --format ir -O0
.venv/bin/python main.py demo/joins.etl --run --output /tmp/cauce-c4
cat demo/joins_result.csv
```

El resultado es `cliente,importe` con filas `(2,30), (1,10), (2,40)` en ese orden.
Modificar el CSV derecho para duplicar una clave o quitar la clave 2 produce el
mismo fallo de contrato con y sin optimización.

Las 15 pruebas C4 comparan resultados y esquemas Polars, errores de contratos,
NULL/nulabilidad, vacíos, tipos físicos, claves invertidas, String, Decimal y NaN,
columnas derechas, ramas compartidas, operaciones antes/después de la proyección,
OUTPUT y USE, lectura/validación conservadas, snapshots de ejecución, compilación
sin IO y paridad analyze/compile_program. Recorren las 120 permutaciones de los
cinco pases predeterminados. El verificador del navegador añade eliminación C4,
obligación en Python generado, -O0, abstenciones y diagnóstico con span en Pyodide.

## Límites

Se elimina únicamente el lado derecho de INNER con clave simple y garantía
explícita. No se optimizan joins externos, claves compuestas ni planes cuyo
uso de columnas requiera atravesar una operación antes de encontrar SELECT.
Se mantiene el JOIN ante nombres de columnas desconocidos o garantías ausentes.
No hay propagación interprocedural de integridad ni prueba estática de datos.

La validación materializa ambas entradas y usa memoria; aún realiza un anti join
para comprobar pertenencia. La optimización elimina el JOIN que construía las
columnas combinadas, no el trabajo necesario para justificarlo. Las
[mediciones C5](evaluacion.md) incluyen todo ese coste y documentan mejoras
observadas y controles; no prueban una mejora universal ni miden memoria pico.
No hay transacción global ni bloqueo de archivos: la instantánea vincula esta
obligación y su resultado, no todos los consumidores independientes del pipeline.
