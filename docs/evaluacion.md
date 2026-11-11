# Evaluación experimental reproducible de Cauce (C5)

## Reproducción

Requiere Python >= 3.11, el checkout y las versiones de `requirements.txt`.
No usa red ni conectores durante las campañas; no necesita DuckDB para los
benchmarks, aunque la suite completa sí prueba ese conector.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e . --no-deps
# Comprobación rápida; también es el modo por defecto.
.venv/bin/python -m benchmarks --mode small --output benchmarks/results/small
# Campaña representativa y reporte, sin intervención adicional.
.venv/bin/python -m benchmarks --mode measure --sizes 10000,200000,1000000 \
  --seed 20261111 --threads 4 --warmups 2 --repetitions 10 \
  --output benchmarks/results/representativa
```

Cada comando genera datos deterministas, compila, exige equivalencia, comprueba
errores, mide y crea `report.md`. El destino debe ser nuevo para no mezclar
campañas; omitir `--output` usa un timestamp. Sin `--sizes`, measure usa solo
10 000 y 200 000 filas. El modo pequeño usa 64 filas, un calentamiento y dos
repeticiones; es una comprobación funcional, insuficiente para conclusiones de
rendimiento. Las pruebas de unittest ejecutan exclusivamente tamaños pequeños.

## Workloads y oportunidades reales

La matriz ejecuta **O0**, `constantes`, `rangos`, `filtros`, `joins`, `muertos`,
`default` (constantes,rangos,filtros,joins,muertos) y **manual**, en ambos
escenarios del motor. Todos los programas y versiones Polars están bajo
[`benchmarks/`](../benchmarks/README.md).

| Programa | Oportunidad/control | Orden comparado |
|---|---|---|
| rangos | `[100,900)` implica `>=0`, `<=900` e IS NOT NULL; `>100` debe sobrevivir | SORT id |
| clasicas | Aritmética constante, FILTER TRUE, filtros consecutivos y rama muerta | SORT id |
| join | INNER VERIFY MANY_TO_ONE seguido de SELECT exclusivamente izquierdo | Orden izquierdo C4 |
| combinado | Los cinco pases; filtros antes/después de JOIN; DERIVE y SUM/COUNT | SORT cliente |
| control_limites | `>=100` no implica `>100`; rangos debe abstenerse | SORT id |
| control_join | Proyección observable de ambas claves y una columna derecha; O3 se abstiene | Orden izquierdo C4 |
| control_sin_garantia | INNER sin VERIFY: O3 se abstiene | Canónico, sin garantía de orden |
| agregados | SUM SQL, COUNT filas/no NULL; grupos en orden de aparición; agregado global | Orden del backend |

No todos los pases cambian cada programa. El arnés comprueba la matriz de
transformaciones esperadas mediante la IR obtenida de la API pública. Compara
nodos, expresiones, enlaces y procedencia; `structure.json` conserva las IR
completas y las pruebas de rangos/joins. `structure.csv` separa cambios,
eliminaciones y recuentos de los tiempos. Añadir anotaciones de hechos sin
cambiar operadores no cuenta como optimización. Por ejemplo, O3 cambia JOIN
por CHECK_JOIN y puede ahorrar trabajo sin reducir el número de nodos.

## Datos y equivalencia obligatoria

`random.Random(seed)` local genera ventas con id Int64, clave cliente Int64,
monto Float64 y texto String; clientes tiene clave Int64, nombre String no
nullable y peso Int64 nullable. La dimensión tiene
`max(2,min(10000,filas//10))` filas. El orden de ambas tablas se baraja. Las ventas
incluyen claves repetidas, valores límite/adyacentes, NULL, NaN, infinitos,
cadenas vacías y Unicode; hay un grupo con todas sus medidas NULL. La semilla
es 20261111 por defecto; los casos de esquina usan semillas fijas separadas.
Los tamaños indican filas izquierdas, no bytes ni filas finales.

Antes de medir se comparan **todas** las configuraciones y baselines con O0 en
vacíos de ambas tablas, izquierda vacía, límites/NULL/NaN, medidas todas NULL y
filas duplicadas. Se vuelve a exigir equivalencia con los datos de cada tamaño,
en cada escenario; también después de cada ejecución cronometrada. El tiempo
de comparación queda fuera del intervalo. Se comprueban puertos de salida,
nombres y orden de columnas, dtypes físicos, dimensiones, cantidad de NULL y
valores exactos. Se verifica que los datos no hayan cambiado tras las rondas.

Sin orden garantizado se ordenan lexicográficamente **todas** las columnas
usando Polars, con NULL al final, y se comparan exactamente. Esto conserva
multiplicidad y distingue NULL de NaN, sin convertir filas a strings ni usar
hashes aproximados. En los demás programas se exige la misma secuencia, también
en agregaciones cuyo backend conserva orden de aparición.

El baseline manual usa expresiones Polars escritas a mano, no IR ni código
generado. Combina filtros de forma idiomática, pliega constantes en el fuente y
omite ramas sin uso. Conserva los contratos INPUT/OUTPUT y, para C4, llama a
`PolarsRuntime.verify_many_to_one`, hace el INNER con `coalesce=False` y
`maintain_order='left'` y proyecta las columnas requeridas. No hay baseline sin
validaciones presentado como equivalente. SUM usa
`when(col.count()>0).then(col.sum())`; COUNT se convierte a Int64. Los tests
añaden resultados concretos de agregación y comprueban ambas claves del JOIN.

El corpus independiente contiene once violaciones de ejecución en tres
workloads contractuales: duplicados derechos incluso con izquierda vacía,
referencia ausente, derecha vacía, NULL en cada clave, dtype físico distinto,
contrato derecho no clave, contrato izquierdo, esquema y tipo de entrada.
O0, cada pase, default y manual deben conservar el código de error (**264**
comprobaciones). Otros tres programas inválidos prueban columna inexistente,
predicado numérico y tipos de JOIN en las siete configuraciones del compilador
(**21**). Sus controles Polars reales fallan al materializar; no se afirma que
Python carezca de comprobadores estáticos externos. Los errores no se mezclan
con muestras de ejecuciones válidas. Si cualquier comprobación falla, el arnés
aborta y no publica los CSV de medición.

## Costes, cachés y protocolo

**Compilación** mide `analyze(..., artifacts=('python',))` con el reloj
monotónico `perf_counter_ns`: scanner, parsing, AST, validación estructural,
lowering, inferencia, pases y generación. Incluye la gestión pública de
diagnósticos; no altera fases para cronometrarlas. Excluye imports, lectura del
fuente, serialización adicional de IR y compile/exec de CPython al cargar el
Python emitido. La estructura se obtiene en una llamada independiente sin
cronómetro. Se mide una vez por workload/configuración/repetición, sin duplicar
por tamaño ni por motor; `size=0`, `scenario=not_applicable` identifican este
coste independiente de datos. Manual no tiene compilación DSL; no se exporta un
cero ficticio.

**Ejecución** empieza antes de crear el runtime e invocar el pipeline/baseline;
termina al materializar todas sus salidas. Incluye resolución de esquemas,
contratos, conteos de nulos, snapshots de ambas entradas C4, unicidad, anti join
de pertenencia y el JOIN restante o CHECK_JOIN. No se descuenta trabajo previo
al collect del llamador. Excluye generación de datos, compilación, carga del
Python, comparación y escritura del reporte. No hay IO de conectores ni SINK.

Cada configuración recibe los mismos DataFrames residentes; cada invocación
construye planes y resultados nuevos. No se conserva un resultado para el
siguiente pase ni se relee un archivo solo en algunas configuraciones. Se
mantienen cachés CPU/SO y GC habituales. Los contratos que materializan planes
por separado conservan ese coste, incluso si repiten trabajo. Se ejecutan
calentamientos y después rondas de repeticiones; en cada ronda se barajan los
pares configuración/escenario mediante la semilla. Las compilaciones también
se barajan. El orden de workloads y tamaños es el declarado; `sequence` permite
reconstruir el orden medido. No se ejecutan muestras en paralelo.

Se exportan muestras individuales en **ms**, mediana, P25, P75, IQR, mínimo,
máximo y N. Los percentiles interpolan en la posición `(n-1)*p`. La razón
`speedup_vs_O0 = mediana(O0)/mediana(configuración)` usa igual fase, workload,
tamaño y escenario. Valores >1 indican menos tiempo; <1, más tiempo observado.
No se agregan razones entre workloads, no se fija un umbral en las pruebas y
no se afirma significancia estadística.

## Control del motor Polars

Se inspeccionó la API instalada **2.1.0**: `LazyFrame.collect` recibe
`optimizations=QueryOptFlags(...)` y `QueryOptFlags.none()` está disponible.
Se guardan su firma y la representación completa de flags por defecto/none
en metadatos; esta API se declara inestable en la
[documentación oficial](https://docs.pola.rs/api/python/version/2/reference/lazyframe/api/polars.QueryOptFlags.html).

| Escenario | Materializaciones finales | Materializaciones internas del runtime |
|---|---|---|
| normal | `collect()` habitual, engine auto | Opciones habituales |
| final_flags_none | `collect(optimizations=pl.QueryOptFlags.none())`, engine auto | Opciones habituales |

En esta versión none desactiva predicate/projection/slice pushdown,
simplify_expression, comm_subplan/subexpr_elim, cluster_with_columns,
check_order_observe, fast_projection, sort_collapse, pre_partition_hive,
join_order y row_estimate; **type_coercion y type_check siguen activos**.
La representación exportada es la evidencia de las opciones efectivas.
El segundo escenario solo controla las salidas; contratos de nulabilidad,
snapshots y anti join C4 conservan el optimizador habitual. No se denomina
«Polars sin optimización», ni permite aislar todas las optimizaciones del motor.
No se modificó ni interceptó el runtime para obtener esas cifras.

La entrada `python -m benchmarks` fija `POLARS_MAX_THREADS` antes de importar
Polars y verifica `thread_pool_size()`. Ese pool no se puede cambiar después de
inicializarse, según la
[documentación oficial](https://docs.pola.rs/py-polars/html/reference/api/polars.thread_pool_size.html).
`--threads` vale 4 por defecto y sustituye el valor heredado en el proceso del
arnés; los metadatos guardan el número efectivo y las variables relevantes.

## Artefactos y amenazas a la validez

- `samples.csv`: fase, workload, filas, semilla, configuración, pases, escenario,
  repetición, secuencia, valor y unidad.
- `summary.csv`: mediana, percentiles, IQR, extremos, N y razón con O0.
- `structure.csv/json`: recuentos y cambios, IR y pruebas de reescritura.
- `errors.csv`: caso, fase y código exigido/observado; controles Polars.
- `metadata.json`: opciones, versiones, revisión y estado Git, hashes de fuentes
  exactos, Python/Polars/Lark, plataforma, CPU, RAM total cuando el SO la
  expone, hilos, firma/flags, manifiestos IPC de datos y equivalencia.
- `report.md`: tablas reales de tiempos/estructura, expresividad descriptiva,
  comandos de reproducción y límites. LOC cuenta líneas no vacías/comentadas;
  indica funciones manuales y helpers compartidos, sin inferir legibilidad.

Los datos se regeneran con semilla; el hash IPC sin compresión permite
verificar contenido, esquema y orden con el mismo entorno. No se guarda el
dataset para cada configuración. Los artefactos se publican juntos al terminar
correctamente y permanecen fuera de Git; se conserva en esta documentación la
interpretación de las mediciones realizadas.

Limitaciones: una máquina, ocho workloads sintéticos y una semilla; sin IO,
memoria pico, energía, arranque frío ni evaluación con usuarios. El motor puede
absorber optimizaciones propias. La comparación es exacta, pero los ejemplos
de suma usan valores enteros representados como Float64 dentro de magnitudes
exactas (además de NULL/NaN/inf); no evalúa todos los efectos del redondeo ni la
aritmética Decimal. El baseline comparte contratos con el runtime y podría
compartir sus defectos; las pruebas de contrato existentes son una salvaguarda,
no una demostración formal. El sistema operativo, cachés y ruido térmico
siguen activos. Una diferencia pequeña frente al IQR no se interpreta como
mejora demostrada; tampoco se infiere rendimiento a partir de nodos eliminados.

## Resultados y verificaciones

Campaña realizada el **11 de noviembre de 2026, 15:38–15:41 (America/Lima)**
sobre la implementación `efe1399`, con Python **3.13.13**, Polars **2.1.0**,
Lark **1.3.1**, Apple **M5 Pro**, 15 CPUs lógicas, **24 GiB** de RAM,
macOS **27.2 arm64**, cuatro hilos Polars. Semilla **20261111**; tamaños
**10 000, 200 000 y 1 000 000**; dos calentamientos y diez repeticiones por
celda, ambos escenarios. El estado Git solo contenía los cambios ajenos en
`.gitignore` y `uv.lock`; los hashes de implementación están en los metadatos.

Se obtuvieron **4 400 muestras**, **440 resúmenes**, **56 registros
estructurales**, **1 024 comparaciones previas** y **285 errores esperados**.
Además, cada una de las 3 840 ejecuciones cronometradas y sus calentamientos
pasó equivalencia. Se recalcularon desde `samples.csv` la mediana, P25/P75,
IQR, extremos y razón de todas las celdas de `summary.csv`, sin discrepancias.
El modo pequeño final obtuvo 368 muestras y 768 comparaciones previas.

Estos son resultados reales de esta máquina. **Mediana (IQR), en ms**, a un
millón de filas, escenario **normal**. La razón compara O0 con default.

| Workload | O0 | Default | Manual contractual | O0/default |
|---|---:|---:|---:|---:|
| rangos | 12.4385 (0.4826) | 12.6280 (0.5622) | 12.4837 (0.2974) | 0.985 |
| clasicas | 15.7956 (1.6553) | 16.3338 (2.1254) | 16.7759 (0.9474) | 0.967 |
| join | 11.4485 (0.7292) | 2.6018 (0.8249) | 12.2013 (1.6387) | 4.400 |
| combinado | 13.1244 (1.5899) | 8.7495 (0.9066) | 13.7256 (1.2790) | 1.500 |
| control_limites | 20.8111 (3.0886) | 21.8753 (0.7691) | 21.2934 (1.1094) | 0.951 |
| control_join | 16.2328 (1.4793) | 15.7612 (1.0344) | 15.2197 (1.3988) | 1.030 |
| control_sin_garantia | 3.5081 (0.2426) | 3.4795 (1.1039) | 3.7154 (0.8799) | 1.008 |
| agregados | 3.9562 (1.4560) | 3.5889 (0.7851) | 3.9865 (0.8309) | 1.102 |

Efectos **individuales** pertinentes, mismas filas y escenario; O0 es el de la
tabla anterior. Los resultados completos de todos los pases y tamaños están
en el reporte exportado.

| Workload | Pase aislado | Mediana (IQR) ms | O0/pase |
|---|---|---:|---:|
| rangos | rangos | 12.1560 (1.2670) | 1.023 |
| clasicas | constantes | 16.4054 (1.5394) | 0.963 |
| clasicas | filtros | 15.6947 (1.0696) | 1.006 |
| clasicas | muertos | 16.4080 (2.0048) | 0.963 |
| join | joins | 2.2660 (0.3824) | 5.052 |
| combinado | rangos | 13.1384 (1.2914) | 0.999 |
| combinado | joins | 8.7860 (1.1119) | 1.494 |
| control_limites | rangos (abstención) | 21.0660 (1.1974) | 0.988 |
| control_join | joins (abstención) | 15.1985 (2.0569) | 1.068 |

La ganancia observada de JOIN incluye **toda** la validación C4. En join,
CHECK_JOIN mantiene los mismos cinco nodos y evita construir las columnas
combinadas; en combinado se pasa de 14 a 10 nodos. No hay evidencia aquí de una
mejora clara de O1 con el motor habitual: en rangos, default elimina un nodo y
registra dos pruebas, pero la mediana es ligeramente peor. En clasicas se pasa
de ocho a cinco nodos y aun así default tarda aproximadamente un 3.4% más. Las
diferencias son pequeñas respecto a la dispersión y no se presentan como
regresiones estadísticamente demostradas.

Los controles aportan una advertencia concreta: control_join, control_sin_garantia
y agregados **no transforman operadores** con default, pero sus medianas también
varían. Por ejemplo, el 1.102 de agregados no puede atribuirse a una reescritura
que no ocurrió. Tampoco se explica una reducción de tiempo usando solamente
el número de nodos. El baseline manual contractual conserva el JOIN y su coste;
no supone una cota inferior de una implementación experta que eliminase ese
JOIN manualmente tras verificar las mismas garantías.

En **final_flags_none**, a un millón de filas, las razones O0/default fueron
**1.047** (rangos), **1.057** (clasicas), **6.788** (join) y **2.231**
(combinado). Para join/default se midieron **2.4185 ms (IQR 0.4374)**; para
combinado/default, **8.4773 ms (1.6127)**. Estas razones tienen **su propio O0
del mismo escenario**. Cambiar flags solo en salidas afecta de forma distinta
a JOIN y CHECK_JOIN porque sus planes finales difieren; los snapshots y el anti
join anteriores conservan las opciones habituales. No se atribuyen estas
razones a desactivar globalmente Polars.

**Compilación completa de la API**, mediana (IQR) en ms, independiente de tamaños:

| Workload | O0 | Default |
|---|---:|---:|
| rangos | 2.1709 (0.8596) | 1.9305 (0.3274) |
| clasicas | 2.1498 (1.6172) | 2.1957 (0.8924) |
| join | 1.2116 (0.3656) | 1.4818 (0.2164) |
| combinado | 2.7173 (0.3278) | 3.6514 (1.3854) |
| control_limites | 1.0429 (0.3138) | 1.2326 (0.3462) |
| control_join | 1.2233 (0.4685) | 1.3165 (0.1203) |
| control_sin_garantia | 1.3707 (1.3490) | 2.3864 (1.1648) |
| agregados | 1.2089 (0.1289) | 1.4427 (0.2217) |

Los pases añaden análisis —rangos y joins vuelven a inferir esquemas— y en
general aumentan el coste de compilación. La dispersión en varias celdas es
alta; el caso rangos no permite afirmar que activar más fases acelere el
compilador. No se amortiza este coste dentro del tiempo de ejecución.

Artefactos locales de esta campaña:
`benchmarks/results/representativa/{samples.csv,summary.csv,structure.csv,structure.json,errors.csv,metadata.json,report.md}`.
Permanecen ignorados por Git y se regeneran con el comando exacto al principio
de este documento. No se promete reproducir los mismos nanosegundos; sí datos,
programas, garantías, opciones y protocolo. Para llevar las tablas al artículo
final todavía corresponde discutir otras máquinas, IO y memoria si el equipo
amplía el estudio; eso no está medido en C5.

Verificación de la entrega: **131 pruebas Python** (11 del arnés), modo pequeño,
campaña representativa, demos regeneradas con 131 pruebas, **4 pruebas web**,
build de producción y comprobación Pyodide con Vite mediante `playwright-cli`.
No se modificó el núcleo ni el contrato JSON 4; la comprobación de navegador
cubre los snapshots regenerados. C5 no implementa el servicio ni páginas web.

## Publicación de la evidencia y página `/evaluacion` (paso E)

La campaña `representativa` descrita arriba se publica como **evidencia histórica**:
fue medida el 11 de noviembre de 2026 (20:38:57–20:41:02 UTC) sobre la revisión
`efe13996d9201788c9fc8cd7c6f458ca68035a04`. La web no vuelve a medir, no ejecuta el
arnés y no presenta esas cifras como una medición del HEAD actual ni del programa
abierto en el estudio. Para medir el mismo código hay que situarse en esa revisión.

### Selección, procedencia y depuración

`benchmarks/results/` sigue ignorado por Git y `.gitignore` no cambia globalmente.
La selección explícita vive en [`web/content/evaluation.json`](../web/content/evaluation.json):
campaña, directorio de origen, archivos autorizados, modo de publicación, rol de cada
archivo y textos de los workloads. Solo se publican siete archivos en la instantánea
versionada `web/public/evidencia/c5-representativa/`, que es exactamente lo que se
ofrece para descarga en `/evidencia/c5-representativa/`:

| Publicado | Origen | Publicación |
|---|---|---|
| `samples.csv`, `summary.csv`, `structure.csv`, `structure.json`, `errors.csv`, `report.md` | mismo nombre | Copia byte a byte (mismo SHA-256) |
| `metadata.public.json` | `metadata.json` | **Versión depurada**: solo `/environment/python_executable` se sustituye por un marcador |
| `manifest.json` | — | Generado al publicar: campaña, recuentos, procedencia, hashes publicado y original de cada archivo y depuraciones aplicadas |

La ruta del intérprete contenía la ruta absoluta del host y el usuario local; no aporta
información científica (la versión de Python sigue en `environment.python`). La depuración
exige que `metadata.json` conserve el formato exacto del arnés, de modo que el archivo
publicado difiere del original **solo** en ese valor. Por eso su manifiesto declara
`identical_to_original: false` y ambos hashes; nunca se presenta como copia exacta.
Ningún archivo publicado puede contener rutas `/Users/`, `/home/` o `C:\Users\`.
`report.md` se publica intacto: su frase «estos artefactos generados no se versionan»
describe la campaña original, anterior a esta instantánea (nota en el manifiesto).
Los CSV publicados se versionan mediante una excepción acotada,
`!web/public/evidencia/**/*.csv`, y otra equivalente en `.dockerignore`.

### Validación, generación y comprobación

`benchmarks/evidence.py` (solo biblioteca estándar; no importa Polars ni el arnés)
valida una campaña original o pública y falla con mensajes comprensibles ante:
encabezados y tipos incorrectos, valores no numéricos, negativos o no finitos, unidad
distinta de ms, secuencias o celdas duplicadas, workloads/configuraciones/escenarios
desconocidos, compilación con `size≠0` o escenario distinto de `not_applicable`,
compilación del baseline manual, celdas ausentes o con repeticiones distintas de 1..10,
semilla distinta, pases incoherentes con la configuración, resúmenes ausentes o duplicados,
estructura CSV distinta de `structure.json` o de la IR que contiene, códigos observados
distintos de los exigidos, recuento de errores distinto de `contract_checks`, campaña no
válida o equivalencias no válidas. **Mediana, P25, P75, IQR, mínimo, máximo, N y razón
frente a O0 se recalculan desde `samples.csv` con `benchmarks.report.summarize`** y
deben coincidir exactamente con `summary.csv` (las 440 celdas coinciden). Nada se
completa con ceros.

`web/scripts/gen_evaluation.py`:

```sh
# Uso habitual, también en un checkout limpio: valida la instantánea y genera
# web/src/evaluation/generated.json (determinista, claves ordenadas).
.venv/bin/python web/scripts/gen_evaluation.py
.venv/bin/python web/scripts/gen_evaluation.py --check
# Solo en el equipo que tiene los originales ignorados:
.venv/bin/python web/scripts/gen_evaluation.py --check --originals benchmarks/results/representativa
# Publicar una campaña (rechaza sustituir otra ya publicada sin borrarla explícitamente):
.venv/bin/python web/scripts/gen_evaluation.py --import-campaign benchmarks/results/representativa
```

La generación comprueba los hashes del manifiesto, rechaza archivos no autorizados en la
instantánea, valida la campaña completa y verifica que los pases que transforman cada
programa en la IR medida coinciden con la curaduría. El JSON de la página contiene
resúmenes, las 4 400 muestras compactas por celda (para el gráfico), recuentos y cambios
estructurales y un resumen de las pruebas de rangos/joins; **no** contiene las IR completas,
que se descargan en `structure.json` bajo acción explícita. `tests/test_evaluation_evidence.py`
cubre sincronización, generación desde una copia aislada de la instantánea, archivos no
ignorados por Git, fidelidad de cada celda, razones/IQR, separación de fases y escenarios,
depuración y once tipos de corrupción. `web/tests/evaluation.test.mjs` recalcula en JS
mediana/IQR/extremos/razón de las 440 celdas y prueba parámetros de URL y lectura.

### Qué muestra la página y cómo leerla

Propósito y alcance; fecha, revisión, entorno y versiones; equivalencia previa; selector
de fase, programa, filas, escenario y configuraciones con tabla (N, mediana, P25, P75, IQR,
extremos, razón, transforma la IR y lectura) y diagrama de puntos de las mismas filas
(muestras individuales, caja P25–P75, mediana y línea de la mediana O0; eje lineal desde 0 ms);
evidencia estructural y pruebas; corpus de errores estático y dinámico; expresividad;
límites; reproducción y descargas con SHA-256 verificable en el navegador.

- Compilación y ejecución tienen intervalos distintos. En compilación no hay selector de filas
  ni escenario (`size=0`, `not_applicable`) y manual no aparece: no se dibuja un cero ficticio.
- La razón es `mediana(O0)/mediana(configuración)` dentro de una sola celda; cada escenario usa
  su propio O0. No se promedian razones entre programas ni se anuncia una mejora global.
- `final_flags_none` se explica como `QueryOptFlags.none()` solo en materializaciones finales,
  con validaciones internas habituales y `type_check`/`type_coercion` activos; nunca como
  «Polars sin optimización».
- La columna **Lectura** es una regla descriptiva, no una prueba estadística: diferencia de
  medianas no mayor que el mayor IQR de ambas filas → «no concluyente»; en ejecución, una
  configuración que no cambia la IR → «sin reescritura», aunque su mediana varíe.
- JOIN separa declaración `VERIFY MANY_TO_ONE`, prueba estática, obligaciones dinámicas que se
  siguen ejecutando y mejora temporal observada. Los controles muestran su abstención.
- Reducción de nodos y de tiempo son medidas distintas; LOC no demuestra legibilidad ni usabilidad.
- Los casos destacados incluyen mejora observada (join), ausencia de mejora clara (rangos),
  abstención (control_join) y coste de compilación; la vista inicial muestra todas las
  configuraciones de `rangos`, sin elegir resultados favorables.

Parámetros de URL validados: `fase` (`ejecucion|compilacion`), `workload`, `filas`
(10000, 200000, 1000000), `escenario` y `config` (lista; O0 siempre incluido). Un valor
desconocido se ignora con un aviso visible y se usa el predeterminado. Cambiar filtros
reemplaza la entrada del historial; los casos destacados crean una nueva, de modo que
atrás/adelante recupera la selección. Consultar la página no modifica `cauce-workspace-v1`,
no carga CodeMirror, Pyodide ni el cliente de ejecución y no consulta la API: funciona con
la API desconectada. La página se carga en diferido (≈57 KiB gzip con sus datos).
