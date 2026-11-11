# Hechos y optimización O1 de rangos (C3)

El pase `rangos`, en `etl_dsl/facts.py`, recorre cada DAG en orden topológico.
Suprime únicamente comparaciones o pruebas de nulos implicadas por hechos de
entrada. No lee datos, ejecuta conectores ni importa Polars.

```text
python main.py demo/rangos.etl --format ir --pases constantes,rangos
python main.py demo/rangos.etl --format ir -O0
```

En la demo, `monto >= 100` permite eliminar `monto >= 0`. Tras SELECT también
permite quitar `monto IS NOT NULL` de un AND, conservando `monto < 1000`.
La demo se compila sin que exista `ventas.csv`; para ejecutarla se necesita ese
CSV con las columnas `id,monto` y los tipos/nulos que exige SOURCE.

Los pases predeterminados son `constantes,rangos,filtros,muertos`. Rangos corre
antes de fusionar filtros para conservar oportunidades y procedencia clara;
también funciona solo o después de `filtros`, simplificando conjunciones dentro
de un bloque fusionado. `-O0` desactiva todos los pases. No se cambian la gramática,
los contratos ni el runtime; C2 siempre comprueba el programa original primero.

## Representación y procedencia

Cada columna tiene un `ColumnFact` inmutable con:

- `lower` y `upper`: límites opcionales, valor entero e inclusión del extremo.
- `nullable`: posibilidad de NULL, independiente del intervalo.
- `null_only`: todos los valores son NULL, demostrado por un filtro o un literal.
- `evidence`: garantías que sustentan el hecho. Cada extremo conserva también
  sus propias evidencias, con pipeline, nodo, condición y span originales.

`NodeFacts` guarda los hechos de salida de un nodo y `contradictory`. Un intervalo
es contradictorio cuando sus extremos se cruzan o coinciden con alguno abierto;
también lo es exigir valores solo nulos y no nulos a la vez. La marca no sustituye
una relación vacía: los filtros que causan la contradicción permanecen intactos.
Tampoco se simplifican filtros posteriores usando implicación vacía.

Los hechos de origen se basan en los esquemas C2: un contrato no nullable aporta
la garantía que el runtime verificará. Una fuente sin contrato no aporta tipos
numéricos ni rangos. Los filtros pueden demostrar presencia y ausencia de NULL
sin inventar tipos para las columnas desconocidas.

## Fragmento demostrado

Se reconocen comparaciones directas de columna numérica con literal entero:
`>`, `>=`, `<`, `<=`, `==`, `!=`, y su forma invertida (`100 <= monto`). Se admiten
negativos con `-` unario. El tipo debe ser conocido y estar contenido en la
familia numérica C2 (`INT`, `REAL`, `FIXED`). Si incluye REAL, los límites se
restringen a `[-2047, 2047]`, enteros exactos en Float16, Float32 y Float64.
Sin REAL, se admiten umbrales enteros entre `-(2**63-1)` y `2**63-1`.

Esta restricción importa porque el contrato DSL DECIMAL también acepta reales.
C2 no distingue sus anchos: Float16 redondea `2049` a `2048`, Float32 redondea
`16777217` a `16777216`, y Float64 redondea el literal `9007199254740993`: inferir que
`x >= 9007199254740993` implica `x > 9007199254740992` produciría una
optimización incorrecta. El pase conserva ambos predicados. También se abstiene
ante umbrales decimales arbitrarios, para no inventar garantías sobre coerciones,
precisión o escala. El pase de constantes previo puede generar un entero seguro.

Las implicaciones requieren `nullable=false`: un límite válido para los valores
no nulos no basta para eliminar un filtro que aún deba quitar NULL. Se admiten
`IS NULL` e `IS NOT NULL`. `!=` demuestra ausencia de NULL, pero no genera un
intervalo con agujeros. Una desigualdad puede ser eliminada si un intervalo ya
excluye su punto. Para eliminar `==`, los extremos deben coincidir y ser cerrados.
No se hace cierre discreto de enteros: `x > 0` no se convierte en `x >= 1`.

Los AND se recorren de izquierda a derecha: se aprende de los términos retenidos
y se eliminan solo los implicados. Si el resultado es contradictorio se conserva
el predicado original completo. OR, NOT, llamadas y comparaciones entre columnas
se conservan; C2 puede aportar nulabilidad posterior, pero no se calculan nuevos
intervalos para esas expresiones.

La equivalencia se comprueba también con Float16/32/64, NaN e infinitos: se respeta el orden de
Polars, donde NaN compara por encima de valores finitos. Un límite inferior solo
no demuestra un límite superior ni que el valor sea finito. No se usa aritmética
de intervalos sobre sumas, divisiones o expresiones con posibilidad de overflow.

## Transferencia por operación

| Operación | Hechos de salida |
|---|---|
| SOURCE / INPUT | Nulabilidad de C2; sin intervalos provenientes de datasets. |
| FILTER | Intersección de límites y hechos de nulos del fragmento anterior. |
| SELECT / DISTINCT | Solo las columnas proyectadas, con sus hechos. |
| RENAME | Renombrado simultáneo de hechos; conserva la procedencia original. |
| SORT | Conserva los valores y sus hechos. |
| DROP_NULLS | Conserva intervalos y garantiza no nulos en los destinos. |
| DERIVE | Invalida el destino y aprende singleton de literal entero seguro, literal NULL o alias directo de columna. Lee todos los aliases contra la entrada original. |
| FILL_NULL | Descarta el intervalo del destino, incluso si antes no era nullable: el supertipo puede cambiar por el reemplazo. Conserva otras columnas y usa nulabilidad de C2. |
| JOIN | Descarta intervalos y contradicciones de ambas entradas; adopta nulabilidad C2 según tipo de join. |
| AGGREGATE | Descarta intervalos y contradicciones; una agregación global puede producir una fila aun sobre entrada vacía. Adopta nulabilidad C2. |
| USE | Verifica/ejecuta los contratos existentes; sus puertos parten de C2 sin intervalos entre pipelines. Cada pipeline se optimiza independientemente. |
| OUTPUT / SINK | Conserva valores y controles del runtime; OUTPUT puede aportar garantía no nullable. |

Actualmente DERIVE exige nombres nuevos; no se habilita sustitución. La invalidación
del destino evita reutilizar un hecho cuando se retira un nombre mediante RENAME
y luego se vuelve a introducir con DERIVE. Las ramas reciben copias independientes:
un filtro de una rama no refina a sus hermanas ni modifica al productor compartido.

## IR y prueba de cada reescritura

La IR agrega dos campos opcionales y aditivos en `Module`:

- `range_facts`: instantáneas por nodo/puerto al ejecutar el pase, excluyendo los
  filtros que este elimina. USE identifica salidas como `instancia.puerto`.
- `range_rewrites`: historial acumulado. Cada entrada tiene pipeline, nodo,
  `origin`, span, predicado antes/después, acción (`remove_filter` o
  `simplify_predicate`), explicación, hechos que la prueban y consumidores
  reconectados. Los spans y evidencias no se reconstruyen desde texto impreso.

Los campos aparecen vacíos cuando no se ejecuta rangos. Las instantáneas describen
la etapa de rangos; pases posteriores pueden fusionar/eliminar nodos. El historial
se conserva para poder explicar esos cambios, no se presenta como esquema final
recalculado. `format_module` imprime al final las reescrituras, intervalos y fuentes
de las garantías; el JSON de `ir_after.module` contiene la evidencia completa.
El artefacto C2 `schemas` sigue describiendo la IR original sin modificar su forma.

El contrato JSON sube a versión 3: se agregan campos al módulo, que los
consumidores tratan como estructura abierta; también se actualizan el discriminante
TypeScript, las pruebas y los snapshots. No se añaden
artefactos ni se cambia el protocolo del worker; el navegador recibe las mismas
fuentes Python que CPython. No se implementa todavía la vista gráfica W2.

## Evidencia de cierre y límites

La suite completa pasa 105 pruebas Python. Las 17 pruebas de C3 incluyen
equivalencia con Polars para límites abiertos/cerrados, igualdad, nulos,
contradicciones, ramas compartidas, renombrado y reutilización de nombres,
invalidación por FILL_NULL, agregaciones, todos los JOIN y USE. Comprueban además
24 órdenes de pases, 40 pares de predicados con semilla fija, Float16/32/64 con NaN e
infinitos, Decimal y entradas vacías, conservación de errores de contrato,
paridad de APIs y compilación sin IO. No son benchmarks ni certifican velocidad.

Se verifican también las 4 pruebas web, build de producción, demos regeneradas y
Pyodide mediante `playwright-cli`: 32 comparaciones CPython/WASM, diagnósticos C2,
reescritura O1 con prueba estructurada, control -O0 y corrección en CodeMirror.

Quedan fuera C4 (unicidad/referencias y eliminación de JOIN), C5 (mediciones),
propagación interprocedural de rangos, aritmética abstracta y umbrales con precisión
arbitraria. La abstención conserva los predicados y sus verificaciones de ejecución.
