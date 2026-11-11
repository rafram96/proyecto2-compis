# Ejecución privada de Cauce (paso D)

Implementado para una instancia local/privada en POSIX (Linux/macOS), sin despliegue público. El contrato HTTP es **1** y el análisis del compilador sigue en **4**. FastAPI, Pydantic y Uvicorn pertenecen al adaptador; el núcleo y Pyodide no incorporan dependencias HTTP. `psutil` mide y limita RSS; `httpx` sirve a las pruebas de integración. Las versiones comprobadas están en `requirements-service.txt`.

## Arranque reproducible

Desde la raíz, con Python 3.11 o superior y Node 24:

```sh
# pip o, si el entorno fue creado con uv, uv pip install --python .venv/bin/python ...
.venv/bin/python -m pip install -r requirements-service.txt
.venv/bin/python -m service.prepare
.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
# Otra terminal:
cd web
npm ci
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Abrir `/estudio`, compilar, ir a Resultados, elegir pipeline y cada dataset autorizado, y pulsar Ejecutar. Por ejemplo: `ventas` y `ventas.pedidos → orders@1`. Ejecutar envía el fuente y opciones al servidor; compilar permanece en Pyodide y funciona sin el servicio. La primera descarga de Pyodide requiere conexión.

Vite redirige `/api` al puerto 8000. Para otro puerto, arrancar Vite con `CAUCE_API_TARGET=http://127.0.0.1:8017`. El proxy conserva Host/Origin; las mutaciones rechazan orígenes distintos. No hay CORS público ni credenciales.

Build y mismo origen:

```sh
cd web
npm run build
cd ..
.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
# http://127.0.0.1:8000/estudio, /docs/... y /ejemplos/...
```

El servicio entrega `web/dist`. Assets, ruedas Python y rutas API inexistentes mantienen 404; las rutas SPA sin extensión recuperan `index.html`. También se puede usar Vite preview con el mismo proxy. No se importan módulos `/src/` en los recorridos de ejecución de producción.

Variables del servicio: `CAUCE_STORAGE` (por defecto `data/cauce-service`), `CAUCE_DATASETS` (`data/cauce-datasets`), `CAUCE_STATIC` (`web/dist`) y `CAUCE_TIMEOUT` (30 segundos). Preparar otro catálogo con `python -m service.prepare directorio`; arrancar con ese mismo `CAUCE_DATASETS`. El catálogo se carga al iniciar: después de preparar/reparar datos, reiniciar el servicio. Nunca se toma un directorio del navegador.

Docker local, sin publicación:

```sh
docker compose --profile web up --build cauce
# http://127.0.0.1:8000/estudio
```

El perfil `web` construye la web y la API en una imagen; prepara datos y usa un volumen `cauce-data`. El puerto se enlaza exclusivamente a loopback. Un worker HTTP, 2 CPU y 1 GiB para el contenedor completo. Los servicios anteriores `etl` y `tests` conservan el target `compiler`. No aumentar workers: SQLite y el scheduler pertenecen a un solo gestor, protegido por un lock del almacenamiento. Esto no distribuye trabajos.

## Datasets y bindings

El catálogo explícito es `service/catalog.py`; capacidades incluye disponibilidad, tamaño, versión y SHA-256, sin rutas del host. La preparación conserva archivos idénticos y rechaza sobrescribir datos diferentes. Reutiliza `scripts/create_demo_data.py` en un temporal limpio; nunca cambia `input/` del usuario. El manifiesto fija los hashes de esa preparación y el servicio verifica de nuevo el archivo al aceptar y copiar la entrada. Los datasets incluidos se comprueban desde las fuentes canónicas del checkout. Cambiar esos contenidos requiere actualizar su versión en una futura entrega.

| ID y versión | Fuente canónica/preparación | Uso verificado |
|---|---|---|
| `join-orders@1` | `demo/joins_pedidos.csv`, incluido | `join_verificado.pedidos` |
| `join-customers@1` | `demo/joins_clientes.csv`, incluido | `join_verificado.clientes` |
| `orders@1` | Generador existente: `orders.csv` | Ventas, pendientes corregido, clean_orders y order_report |
| `bank-clients@1` | Generador existente: SQLite `clients` | credit_risk |
| `bank-customers@1` | Generador existente: SQLite `customers` | order_report |
| `ranges-sales@1` | `service.prepare`: `id,monto` con 50.0, 100.0, 250.5, NULL, 1000.0 | rangos, OUTPUT de dos filas |
| `join-duplicates@1` | Incluye de nuevo una fila del CSV canónico derecho | Fallo intencional E_JOIN_UNIQUE |

Sin preparación **solo los dos datasets JOIN incluidos** están disponibles. Rangos no reutiliza orders: sus columnas/contratos son distintos. Los catálogos de ejemplos y el servicio explican ese estado. El ejercicio NULL original sigue siendo inválido; después de corregirlo, `pendientes.pedidos → orders@1` produce la fila sin status.

Cada binding contiene `pipeline`, `declaration`, `dataset_id` y `version`. Debe haber exactamente uno por SOURCE alcanzado recursivamente mediante USE y por INPUT del pipeline elegido. Un INPUT interno de USE recibe su tabla por FLOW; enviarlo como binding externo se rechaza. Los SOURCE se validan aun si un pase retira su consumidor. La revisión HTTP no interpreta la semántica del lenguaje: usa el AST/IR y validaciones de etl_dsl.

Solo se sustituye `file` sobre la IR del runner, mediante `dataclasses.replace`; se conservan driver y opciones. CSV exige las mismas opciones efectivas y SQLite/DuckDB la misma tabla/schema. Un binding incompatible produce 422, no una sustitución silenciosa. Los contratos de nombres, orden, familias de tipos y nulos permanecen en PolarsRuntime. INPUT utiliza el conector autorizado y luego el contrato original de entrada.

Todas las rutas SOURCE/SINK alcanzadas deben ser relativas, sin `..`, barras inversas, caracteres de control, URLs ni rutas absolutas. Nunca se abren esas rutas lógicas del cliente: SOURCE se copia del catálogo a `inputs/` del trabajo y SINK se redirige a `files/`. Las entradas son copias independientes: un SINK con el mismo nombre lógico no sustituye el dataset ligado. Dos SINK con el mismo nombre lógico siguen compartiendo destino; el modo DuckDB permanece intacto. El runtime del adaptador vuelve a comprobar que sus rutas estén dentro del trabajo. No se modificó la semántica del núcleo ni el contrato JSON 4.

## Contrato HTTP 1

Swagger en `/api/v1/docs` (sin ocupar `/docs` de la SPA). OpenAPI real en `/openapi.json` y copia revisable en [http_openapi.json](http_openapi.json). Los modelos estrictos rechazan campos extra, tipos incorrectos y pases desconocidos. `web/scripts/gen_http.py` genera los tipos TypeScript de ese OpenAPI; `--check` y una prueba web detectan deriva.

| Endpoint | Resultado |
|---|---|
| GET `/api/v1/health` | 200 con estado; 503 si el gestor se detuvo |
| GET `/api/v1/capabilities` | Versiones, conectores, catálogo y límites configurados |
| POST `/api/v1/runs` | 202 con trabajo, identidad y URL de estado |
| GET `/api/v1/runs/{id}` | Estado, diagnósticos estructurados, opciones, métricas, salidas y artefactos |
| POST `/api/v1/runs/{id}/cancel` | Estado terminal después de matar/recolectar el hijo; idempotente |
| GET `/api/v1/runs/{id}/outputs/{outputId}/preview?offset=0&limit=100` | Página de filas con esquema; máximo 100 |
| GET `/api/v1/runs/{id}/artifacts/{artifactId}` | Archivo completo por manifiesto e ID; sin parámetro de ruta |

Solicitud mínima para ventas:

```json
{
  "contract_version": "1",
  "source": "...programa ETL completo...",
  "filename": "ventas.etl",
  "document_id": "id-local-del-documento",
  "revision": 1,
  "pipeline": "ventas",
  "passes": null,
  "bindings": [{"pipeline":"ventas","declaration":"pedidos","dataset_id":"orders","version":"1"}]
}
```

`null` usa los cinco pases predeterminados; `[]` es O0; las listas explícitas conservan orden y repeticiones. Se registran selección y pases efectivos. No hay endpoint de compilación ni se acepta Python del cliente. Se calcula SHA-256 del fuente UTF-8 exacto. El nombre del archivo es lógico y no admite rutas.

HTTP 413: cuerpo mayor que 192 KiB; 422: modelos/opciones/bindings/rutas inválidos; 429: cola o almacenamiento de la demo agotados; 503: ejecutor no disponible. Una solicitud con error estático del programa puede aceptarse y finalizar `failed` con los diagnósticos del compilador. Los fallos dinámicos de un trabajo aceptado también se consultan con HTTP 200 y estado `failed`. 404 identifica ID inexistente; 410 identifica archivos ya caducados mientras existe su tombstone. Las respuestas de validación no reflejan el campo source completo.

## Trabajos, persistencia y recuperación

`queued → running → succeeded | failed | cancelled | timed_out`. El scheduler admite un proceso activo y cuatro posiciones adicionales; durante el despacho inicial una posición puede estar reservada al próximo proceso activo. La ejecución de Polars ocurre en un subprocess nuevo, con directorio de trabajo propio y recompilación desde el fuente. El servidor HTTP valida la forma y los bindings con el núcleo antes de aceptar; no ejecuta pipelines allí.

SQLite conserva metadatos y el manifiesto privado, no tablas ni fuente. El fuente y la solicitud viven temporalmente en `request.json` del trabajo hasta su fin. Al éxito se eliminan solicitud y copias de entrada; al fallo/cancelación/timeout se elimina el directorio completo y no se anuncian salidas parciales. Los logs de Uvicorn pueden deshabilitar acceso con el comando documentado; el runner no registra fuente, filas ni excepciones con datos. Los errores de runtime se reducen a códigos y mensajes sin rutas/valores sensibles. Los diagnósticos estáticos conservan ubicación y archivo lógico.

Cancelación en cola elimina el temporal. Cancelación activa envía SIGKILL al grupo creado por el gestor y espera su terminación antes de responder `cancelled`. No es rollback: SINK anteriores pueden haber escrito dentro del directorio privado. No existe transacción global; archivos parciales no se publican y se borran al fallar.

Al cerrar normalmente se cancelan trabajos en cola y se terminan/recolectan los hijos activos. Tras muerte abrupta, el hijo vigila a su padre cada 200 ms y se mata si pierde ese padre. Al reiniciar, el gestor verifica PID, nacimiento y argv para terminar huérfanos identificados, marca queued/running como `failed/E_INTERRUPTED` y borra temporales/directorios desconocidos. Los trabajos terminados y sus archivos conservan su TTL; no hay reanudación automática.

Caducidad: una hora desde el término, independiente del estado terminal. Se borra el directorio y se marca `expired`; otra hora después se eliminan metadatos. El scheduler limpia cada 50 ms y las consultas también comprueban caducidad. El límite de 128 metadatos, la reserva por trabajos admitidos y la cuota de directorios evitan crecimiento ilimitado. No borrar el volumen mientras corre la instancia.

## Límites de esta demo

| Recurso | Límite aplicado |
|---|---|
| Fuente / cuerpo HTTP | 128 KiB UTF-8 / 192 KiB |
| Concurrencia / espera | 1 proceso / 4 posiciones adicionales |
| Tiempo | 30 s de pared desde el lanzamiento, incluye imports, recompilación, IO y materialización; excluye cola y HTTP |
| CPU del hijo | RLIMIT_CPU: plazo entero + 1 s, al menos 1 s |
| RSS del hijo | 512 MiB, muestreado por psutil cada 50 ms; se mata al excederlo |
| Hilos / descriptores | POLARS_MAX_THREADS=2, OMP/BLAS=1; 128 descriptores |
| Entradas copiadas | 16 MiB sumados por binding |
| Archivo / directorio por trabajo | 16 MiB por archivo (RLIMIT_FSIZE) / 32 MiB para el trabajo, incluidos snapshots e inputs |
| Almacenamiento de instancia | 256 MiB con reserva de 32 MiB por trabajo pendiente/activo; máximo 128 registros, incluida la retención de caducados |
| Salida materializada | 1 millón de filas, 128 columnas; tamaño estimado del frame menor que media cuota RSS |
| Vista previa | hasta 100 filas por petición, sin cargar el resto en el navegador |
| Retención | 1 hora de archivos, 1 hora adicional de tombstone |

Son **límites de admisión/protección de una demo pequeña, no capacidad medida ni SLA**. Los ejemplos comprobados usan entradas pequeñas y procesos alrededor de 100 MiB en el equipo de desarrollo. No se añadió un benchmark ni se cambiaron cifras C5. RSS/directorio son controles muestreados: puede haber sobrepasos entre muestras, y la memoria de los contratos/joins se consume antes de comprobar el frame final. El límite Docker de 1 GiB cubre el contenedor completo; no confundirlo con la cuota del hijo. RLIMIT_FSIZE impide un archivo mayor pero no una transacción ni una cuota de filesystem rígida por trabajo.

Un proceso hijo **no es un sandbox público**. No aísla la red, credenciales del entorno, vulnerabilidades del motor ni todos los archivos del host. El adaptador restringe IO del DSL y rechaza código Python/paths arbitrarios, pero la instancia solo está autorizada para uso local/privado con datasets controlados. No hay cuentas, permisos por usuario, uploads ni colaboración. Exposición pública requiere aislamiento real de filesystem/red y otro diseño de acceso/cuotas.

## Salidas y serialización

SINK usa `PolarsRuntime.sink` sin sustituir su implementación: CSV, Parquet o DuckDB. Se registra la última invocación de cada declaración SINK alcanzada (también dentro de USE) y un snapshot IPC de su frame para preview. Si varias declaraciones escriben el mismo destino, las descargas representan el archivo final compartido; cada snapshot representa la última tabla recibida por esa declaración. DuckDB append conserva su comportamiento de acumulación en el archivo, mientras el preview corresponde al frame de ese SINK. No se promete una tabla distinta por cada invocación repetida de USE.

Los OUTPUT del pipeline elegido se recogen explícitamente mediante `rt.collect` y se escriben en Parquet; OUTPUT internos de USE siguen siendo puertos lazy y solo se materializan si llegan a una salida elegida o a las verificaciones del runtime. Puede repetirse cómputo entre consumidores independientes: no hay cache global. La implementación conserva las obligaciones de VERIFY MANY_TO_ONE en O0 y optimizado: tipos físicos iguales, claves no nulas, unicidad derecha y referencia total izquierda. `joins` elimina columnas combinadas cuando corresponde, nunca esas validaciones ni la lectura derecha.

Cada salida tiene ID, pipeline/declaración, clase, filas, columnas ordenadas y artifact_id. Esquema físico y nulabilidad **observada** (`nullable`: contiene NULL) se distinguen del contrato nullable declarado de OUTPUT. Una tabla vacía válida conserva esquema y archivo; no es un fallo. La descarga completa conserva el formato del SINK o Parquet de OUTPUT; CSV conserva las opciones del programa, pero no lleva tipos físicos como Parquet.

Preview lee una porción del snapshot IPC en el servidor. NULL es JSON null; Decimal y enteros fuera de ±(2^53−1) son strings exactos acompañados por dtype; fechas/horas son ISO; NaN/±Infinity son `{kind:"non_finite",value:"..."}`. Binarios usan base64 etiquetado y duraciones texto etiquetado. No se convierten strings exactos a números en TypeScript. El gráfico opcional usa exclusivamente números finitos de la página actual (hasta 20 filas), sin sumar totales o coercionar decimales.

Solo se publican métricas medidas: `worker_seconds` desde Popen hasta detectar el término (incluye hasta unos 50 ms del sondeo) y pico RSS **observado** por muestras de 50 ms, sin prometer memoria pico exacta. Las filas/tamaños son los archivos reales finales. No se muestran aceleraciones ni tiempos de fases inventados.

## Asociación en el estudio

La referencia en memoria contiene ID del documento, revisión, fuente, nombre, pases, pipeline y bindings versionados de la solicitud. El servicio devuelve además hash del fuente y de datasets. Cambiar opciones marca el trabajo como anterior; una respuesta de otro ID/documento/revisión/hash no reemplaza el trabajo visible. La paginación liga cada respuesta a trabajo/salida/offset y aborta las peticiones obsoletas. CodeMirror permanece montado; ejecución e inspección no disparan compilaciones adicionales.

Solo se sondea un trabajo activo, aproximadamente una vez por segundo. Se pausa con la pestaña oculta y se detiene al salir del estudio; el trabajo sigue ejecutándose en el servidor. Al volver a la misma pestaña se recuperan selección y referencia desde memoria y se consulta de nuevo. Reconectar permite actualizar capacidades/sondeo tras un fallo de red. No se reenvía automáticamente una solicitud de ejecución fallida: si se perdió la respuesta de aceptación, podría quedar un trabajo en el servidor hasta caducar.

Recargar/cerrar pierde referencias de trabajos y bindings en memoria, sin cancelarlos. El documento, pases e inspectores conservan exactamente el formato `cauce-workspace-v1`; no hubo migración ni segundo sistema de documentos. No se guardan datasets, previews ni resultados en localStorage. No hay historial remoto navegable ni recuperación de un job ID mediante URL. Las descargas históricas siguen identificadas por revisión y el servicio controla su caducidad.

## Verificación reproducible

```sh
.venv/bin/python -m unittest discover
cd web && npm test && npm run build
cd ..
.venv/bin/python web/scripts/gen_content.py --check
.venv/bin/python web/scripts/gen_http.py --check
.venv/bin/python web/scripts/gen_compiled.py
# Suite histórica completa con Vite activo:
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5174/
```

Para D se necesita la API normal conectada y una segunda instancia de prueba, en otro almacenamiento y puerto, con un plazo que venza durante el arranque del hijo:

```sh
CAUCE_STORAGE=data/cauce-timeout CAUCE_TIMEOUT=0.02 .venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8018 --no-access-log
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5174/ --execution-only --timeout-api http://127.0.0.1:8018
# El mismo recorrido sobre el build servido por la API:
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:8000/ --execution-only --timeout-api http://127.0.0.1:8018
```

`execution.js` usa UI real y HTTP/runner/archivos, sin imports de `/src/`. Comprueba ventas y descarga Parquet contra filas/esquema del runtime Python sin adaptador; JOIN CSV byte a byte; múltiples salidas; USE; obligación JOIN con O0/O3; edición mientras el servidor observa running; cancelación activa y recuperación; timeout de un proceso real; transporte API desconectado con compilación Pyodide operativa; salida vacía; navegación y recarga v1; teclado, foco, movimiento reducido, ambos temas y móvil. La desconexión se simula abortando transporte del navegador, sin sustituir el compilador. La API de plazo reducido también es real, no una respuesta inventada.

Las pruebas Python cubren además HTTP estricto, catálogo, incompatibilidades, procesos/cola, cuotas, caducidad, symlinks y traversal, archivos ausentes, contratos, especiales JSON, estáticos y reinicio real: se mata Uvicorn, se reinicia sobre SQLite y se comprueba que el hijo huérfano termina, el trabajo queda interrumpido y los trabajos completados siguen disponibles. Los tests web cubren identidad, bindings alcanzados por USE, respuestas tardías, versiones incompatibles y deriva OpenAPI/TS. Los recorridos históricos A/B/C y las 32 comparaciones CPython/Pyodide no se sustituyen por D.

## Evidencia de esta entrega

Verificado el 11 de noviembre de 2026:

- **157 pruebas Python** con `.venv/bin/python -m unittest discover`; las mismas **157** pasan dentro de la imagen Docker (Python 3.12). Incluyen 20 pruebas nuevas del servicio.
- **38 pruebas web** con `npm test`; TypeScript y build con `npm run build`. `gen_content.py --check` y `gen_http.py --check` pasan; demos regeneradas con `gen_compiled.py` y contador 157.
- **Vite, puerto 5177:** suite histórica completa A/B/C, 32 comparaciones CPython/Pyodide, diagnósticos, O1/O0/O3, recuperación del worker, descargas Python exactas e inspectores. Suite D completa contra API 8017 y fixture real de timeout 8018.
- **Build servido por FastAPI, puerto 8017:** suite D completa, con tablas/esquemas y descargas verificadas contra Python, sin imports de `/src/`.
- **Build Docker, puerto local 8019:** suite D completa, suite de contenido y suite de inspectores. En contenido se verifican rutas directas, copias, borradores, documentación, fallos de almacenamiento y ambos temas/móvil. En inspectores, Unicode, pases personalizados, O0, evidencia O1/O3, estados parciales y exploración sin recompilar. La primera ejecución de inspectores sufrió un fallo externo de descarga del CDN Pyodide; el recurso respondió 200 y la repetición íntegra pasó.
- Descarga real de ventas: mismas filas, orden y esquema Parquet que el runtime Python sin adaptador. JOIN: CSV byte a byte igual a la secuencia canónica. USE se compara como conjunto de filas porque su LEFT JOIN sin SORT no promete orden. Se seleccionan salidas independientes y se comprueba una salida vacía real.
- Cancelación y edición se realizan después de observar `running` en el servidor; timeout proviene de un proceso real con plazo de 20 ms. Desconexión aborta el transporte API del navegador, mientras Pyodide sigue editando/compilando. No se simulan filas, archivos ni estados terminales del runner.
- Capturas de resultados revisadas en escritorio y móvil, ambos temas; foco de teclado, tamaños táctiles, desplazamiento interno de tabla/gráfico, ausencia de desbordamiento global y movimiento reducido. Se conserva la identidad visual. El detector mecánico solo señaló un borde anterior del landing, fuera de los cambios de esta entrega.
- Build Docker y configuración Compose comprobados. `/estudio`, `/docs`, `/docs/conectores` y `/ejemplos/ventas` responden 200 en el contenedor; assets/API inexistentes, 404; health, 200. Swagger no ocupa `/docs`.

Los logs, capturas y descargas de `playwright-cli` quedan en `web/.playwright-cli/`, fuera de Git. No hubo despliegue público, campaña nueva de benchmarks ni cambios a cifras C5. D/W3 queda implementado para esta demo privada; W1 global continúa parcial. La siguiente entrega es E (`/evaluacion`), además de los ajustes de estudio pendientes del plan.
