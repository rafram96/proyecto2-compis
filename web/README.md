# Cauce, web del compilador ETL-DSL

Landing (`/`), catálogo (`/ejemplos`), documentación (`/docs`), evaluación C5 (`/evaluacion`) y estudio ampliado (`/estudio`) del compilador de `etl_dsl/`. Se llama **Cauce**: el lecho por donde corre el agua, como el `->` de `FLOW`
lleva los datos. La marca es `~>` (agua que se vuelve flecha) y la historia del nombre son los canales prehispánicos de
Cumbemayo y Nazca.

```bash
cd web && npm install && npm run dev            # http://localhost:5173
npm run build                                    # tsc + vite build
npm test                                         # 45 pruebas de contenido, inspectores, evaluación, documentos, ejecución y worker; Node >= 22.18
.venv/bin/python web/scripts/gen_content.py      # (raíz del repo) genera src/content/generated.json
.venv/bin/python web/scripts/gen_content.py --check # detecta contenido desactualizado
.venv/bin/python web/scripts/gen_evaluation.py   # (raíz) valida la evidencia C5 publicada y genera src/evaluation/generated.json; --check
.venv/bin/python web/scripts/gen_compiled.py     # (raíz del repo) regenera src/data/compiled.json
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5173/ # raíz, Vite iniciado y playwright-cli en PATH
bash web/scripts/gen_icons.sh                    # regenera iconos PNG/ICO y og.png (Chrome + ffmpeg)
```

## Decisiones fijas (no reabrir sin hablar con el equipo)

- **Stack:** Vite + React 19 + TypeScript + Tailwind v4. Tokens en `src/styles/brand.css`, estilos en `src/index.css`.
- **Editor de código: CodeMirror 6** (`src/editor/`), no Monaco. Lenguaje `etl-dsl` con `StreamLanguage` (vocabulario en
  `src/editor/words.ts`, sacado de `etl_dsl/grammar.lark`), autocompletado, diagnósticos con `@codemirror/lint` alimentados por los
  diagnósticos estructurados del compilador y colores `--syn-*` de `brand.css` (el tema cambia sin recrear el editor).
  Los rangos completos se convierten de caracteres Unicode de Python a UTF-16, conservando emoji y expresiones multilínea.
  Se carga en diferido: la página no lo espera para pintarse. `src/components/highlight.tsx` es solo para fragmentos estáticos.
- **Marca B «Deep Ocean + ámbar Polars»:** azul = estructura, ámbar `#FFCC00` = acción. Tema **claro por defecto** con toggle
  (`data-theme` en `<html>`, clave `cauce-theme` en `localStorage`). En claro nunca uses `#00B4D8`/`#0096C7` como texto.
- **Cambio de tema:** revelado circular desde el botón con la View Transitions API (`src/lib/theme.ts`); sin soporte o con
  «reducir movimiento», fundido corto o cambio directo. El icono luna/sol es una sola figura que se transforma.
- **Tipografía:** Montserrat (títulos) + Rubik (texto); Geist Mono solo dentro de código. Cinco tamaños: `--fs-xl|l|m|body|s`.
- **Dirección visual:** skill `design-taste-frontend`, dirección «The product performs» (semilla 1021409496, héroe redibujado a
  «Sentence split by a frame»): fragmentos reales del producto en vez de capturas. Sin gradientes, sin sombras en reposo, sin
  líneas finas fuera de fragmentos `data-ui`, titulares ≤ 2 líneas. Verificar con
  `node .claude/skills/design-taste-frontend/scripts/lint.mjs web/src` e `inspect.mjs <url> --allow mono`
  (`--allow mono` solo porque CodeMirror es código real editable fuera de `<pre>`).
- **Datos = salida real del compilador.** Nada de IR ni Python escritos a mano: las demos salen de `src/data/compiled.json` y las ediciones se compilan con el mismo núcleo en Pyodide.

## El compilador en el navegador

La demostración del landing y el estudio `/estudio` corren **el mismo `etl_dsl`** que la terminal, sin backend:

1. `src/compiler/worker.ts` (Web Worker) descarga Pyodide 314.0.7 (Python 3.14) de jsDelivr la primera vez que alguien pulsa
   «Compilar», instala `public/py/lark-1.3.1-py3-none-any.whl` y copia `../etl_dsl/*.py|lark` (empaquetados por Vite con
   `import.meta.glob`, por eso `vite.config.ts` permite leer fuera de `web/`).
2. `src/compiler/studio.py` llama a la API pública `etl_dsl.analyze`, sin crear archivos ni depender de la CLI privada.
   Devuelve texto de presentación y el contrato estructurado: diagnósticos, versiones, hash del fuente, estado de artefactos,
   AST con posiciones e IR antes/después. La demo solicita los artefactos del formato elegido.
   Lo usa **también** `scripts/gen_compiled.py`. El estudio solicita todos los artefactos y recibe seis presentaciones textuales
   en una sola compilación; cambiar de inspector reutiliza ese resultado, incluso si solo hay artefactos parciales.
   El worker serializa con JSON de Python para conservar `None` como `null` (la conversión directa de Pyodide usa `undefined`).
   `verify_browser.py` compara 32 presentaciones entre CPython/Pyodide y comprueba diagnósticos, O1, O3 y el recorrido de `/estudio`.
3. La demo muestra salidas precalculadas identificadas como tales solo para sus fuentes originales. El estudio comienza sin resultados;
   restaura únicamente el documento. Python se carga al pulsar Compilar; después recompila al editar con una pausa de 320 ms.

Los snapshots del landing guardan texto y resumen de análisis con diagnósticos, sin duplicar los AST/IR estructurados dentro
del paquete inicial. El resultado en vivo sí conserva los artefactos solicitados, incluso cuando una fase posterior falla.
La vista AST compacta oculta posiciones solo en el texto; el contrato en vivo las mantiene. Véase [la API de análisis](../docs/api_analisis.md).

Polars y DuckDB no hacen falta para compilar: el análisis local no ejecuta pipelines ni lee datos. La ejecución del paso D utiliza el servicio Python privado.

## Contenido y recursos

- Programas de ejemplo propios de la web en `scripts/programs/` (`ventas.etl`, `pendientes.etl`); `credit_risk.etl` y
  `demo/optimizaciones.etl` se leen del repo.
- Fotos de Wikimedia Commons en `public/img/` (CC BY-SA, crédito en el pie de cada foto; detalle en
  `scripts/brand/photo-credits.json`). Muestran los canales de Cumbemayo y Nazca, no el producto.
- Iconos: `public/favicon.svg` es la fuente; `scripts/gen_icons.sh` genera `favicon.ico`, `apple-touch-icon.png`,
  `icon-192/512.png`, `icon-maskable-512.png` y `og.png` (plantilla en `scripts/brand/og.html`).

## Rutas y navegación

- `/`: landing y demo breve. **Continuar en el estudio** copia el texto editado y los pases al documento activo, conservando el anterior.
- `/estudio`: editor estable, inspectores Resultado/Tokens/Árbol/AST/FLOW/IR/Esquemas/Python y diagnósticos accesibles desde cualquier fase.
- `/ejemplos`: catálogo de cinco intenciones. `/ejemplos/:slug`: explicación, programa completo, expectativas y requisitos.
- `/docs`: índice de seis guías. `/docs/:slug`: lectura con navegación entre artículos, anclas, tablas y resaltado existente.
- Slugs inexistentes muestran recuperación al catálogo correspondiente y al estudio. Las demás rutas recuperan hacia Inicio/Estudio.
  `/evaluacion` publica la campaña C5 histórica (paso E). No hay URLs con programas ni datos personales.
- La navegación interna usa History API; atrás/adelante conserva el documento. La URL no contiene programas ni datos.
- Editor e inspector quedan en paralelo en escritorio. En móvil, Código/Inspector alterna su visibilidad sin desmontar CodeMirror.
  Un diagnóstico selecciona su intervalo y devuelve al código. Ctrl/⌘ + Enter compila; Esc y después Tab permite salir del editor.

Vite dev y preview ya aplican fallback SPA. En hosting, servir `dist/index.html` para rutas de la aplicación que no sean archivos.
`public/_redirects` se copia al build para hosts compatibles; en Nginx puede usarse [nginx.conf](nginx.conf), montando `dist` en
`/usr/share/nginx/html`. Los assets y la rueda Python deben servirse como archivos reales, con sus errores 404. El ejemplo Nginx
no constituye un despliegue realizado. Verificar siempre el acceso directo a `/estudio`, `/ejemplos/:slug` y `/docs/:slug` en el alojamiento elegido.

## Catálogo y documentación: fuente de verdad

Los manifiestos explícitos viven en `web/content/` (rutas relativas a la raíz del repositorio):

- `examples.json`: slug, nombre, título, objetivo, ruta canónica `.etl`, operaciones, requisitos, expectativas y artículos relacionados.
  Publica `ventas`, `riesgo-crediticio`, `corregir-nulos`, `rangos` y `join-verificado`. El último conserva las obligaciones
  de `VERIFY MANY_TO_ONE`; el tercero se identifica como inválido y declara la sustitución que lo corrige.
- `articles.json`: `primer-programa`, `estructura`, `operaciones`, `null-contratos`, `conectores` y `composicion`.
  Cada artículo selecciona secciones exactas de `docs/lenguaje.md`, `semantica_estatica.md`, `backend_polars.md`
  o la guía canónica `docs/guia_estudio.md`. Incluye introducción adaptada, enlaces y referencia a un programa válido completo.

`gen_content.py` lee únicamente esa selección y genera `src/content/generated.json` con fuentes y hashes.
Una sección renombrada falla en generación; `--check` y las pruebas detectan un resultado desactualizado.
Los programas nunca se editan en JSON generado ni en componentes. `gen_compiled.py` también toma las rutas de ese manifiesto
para las tres demos históricas y deriva la corrección de NULL de la misma regla. Sus salidas siguen siendo precalculadas;
el catálogo y los artículos no presentan IR/Python precalculados nuevos. No se publica automáticamente el árbol del repositorio.

El lector procesa un subconjunto de Markdown sin HTML crudo ni ejecución, conserva tablas/listas/código y adapta enlaces técnicos
publicados a rutas reales. Los fragmentos incompletos están etiquetados; el programa completo se lee de la fuente canónica y usa
el resaltado existente. Catálogo y documentación se cargan en diferido por página; no cargan CodeMirror ni Pyodide al consultar.
No se añadieron dependencias.

**Abrir una copia en el estudio** usa `createDocument` + `openDocument` de `src/workspace/`: id nuevo, nombre canónico,
revisión 1, inspector Resultado y `passes=null`. El documento anterior conserva exactamente nombre/texto/revisión/pases/inspector.
Consultar páginas, artículos, ejemplos o enlaces de diagnóstico no lo modifica. Dos aperturas del mismo ejemplo tienen ids distintos.
Si hay ocho anteriores, se muestra un error y enlace para gestionar borradores, sin cambiar de ruta ni documento.
Si el almacenamiento falla, la copia abre en memoria y el estudio muestra **Sin guardar**, con indicación de descargar antes de salir.
No se garantiza recuperación tras cerrar/recargar en ese caso. El límite total de 512 KiB se mantiene.

Los requisitos distinguen datasets incluidos (`demo/joins_*.csv`) y preparados por `python -m service.prepare`: ventas/riesgo reutilizan `scripts/create_demo_data.py`; rangos se prepara por separado con su propio esquema. Compilar no los consulta, no certifica sus valores y no ejecuta pipelines.
La ejecución y el Python descargado requieren el entorno Python del proyecto, sus dependencias y los archivos declarados.

## Documento, archivos y persistencia

`src/workspace/` mantiene un documento activo: id local, nombre lógico, fuente, revisión, pases e inspector. Texto, nombre o pases
incrementan la revisión; cambiar de inspector no la incrementa. `null` conserva los pases predeterminados del núcleo; `[]` es O0.
La selección y el scroll de CodeMirror permanecen al cambiar inspector o tema. No se persisten cursor, historial de deshacer ni resultados.

- Importar acepta `.etl` UTF-8 hasta **128 KiB**, valida la decodificación y conserva el texto (retira BOM inicial). CodeMirror usa LF
  al editar; un archivo CRLF sin editar se conserva al guardar/exportar. Los nombres de descarga son nombres locales saneados.
- Descargar `.etl` exporta el documento actual. Python solo se habilita si su artefacto está disponible para esa revisión y pases.
  Al editar se marca la salida anterior como desactualizada y se deshabilita su descarga.
- `localStorage`, clave **`cauce-workspace-v1`**, guarda un sobre `{version:1, active, drafts}` validado, con hasta **8** documentos anteriores
  y **512 KiB** de JSON UTF-8 total. No contiene datasets ni artefactos compilados. El guardado es inmediato al cambiar el documento o inspector.
- Abrir ejemplo, importar o recuperar conserva el activo anterior. Borradores anteriores permite recuperar, descargar y eliminar explícitamente;
  alcanzar 8 bloquea la apertura de otro documento hasta eliminar uno, sin expulsión automática.
- Corrupción, versión incompatible, acceso denegado, cuota o límites de tamaño producen un aviso; el editor continúa en memoria y permite descargar.
  No se sustituye un almacenamiento inválido al abrir la página; la siguiente edición/apertura intenta guardar el estado validado.
  Si hay cambios sin guardar, el navegador avisa antes de salir. Un fallo de almacenamiento **no** garantiza recuperación tras cerrar/recargar.
- Los borradores pertenecen a este navegador y origen. No hay sincronización entre dispositivos ni resolución de ediciones simultáneas entre pestañas.

## Revisiones y recuperación del compilador

Cada resultado queda asociado al id, revisión y pases de su solicitud. Las respuestas antiguas no sustituyen el resultado actual; los
resultados anteriores del mismo documento se etiquetan, y los de otro documento se ocultan. Se conservan artefactos parciales y sus estados
`available`, `not_requested`, `blocked`, sin inventar salida para fases fallidas. El estudio solicita todas las fases en cada compilación;
por eso un diagnóstico de backend también puede aparecer mientras se inspecciona AST. Esto no certifica ejecución de datasets.

El cliente permite **una solicitud en curso y una pendiente**, reemplazando la pendiente con la más reciente y rechazando su promesa.
Valida mensajes/contrato 4, ignora callbacks de workers reemplazados y atiende `onerror`, `messageerror`, inicialización y envío fallidos.
Carga: **60 s** máximos desde el inicio, sin extender el plazo por mensajes de progreso. Compilación: **12 s** desde que Python está listo.
Un fallo o reinicio termina el worker y rechaza todas las promesas; la interfaz sale del estado ocupado. **Reiniciar compilador** conserva
el documento y requiere pulsar Compilar para descargar/cargar Python otra vez. No hay fallback a un servicio remoto.

## Verificación reproducible

Desde la raíz: `.venv/bin/python -m unittest discover` (**157 pruebas**) y `.venv/bin/python web/scripts/gen_compiled.py`.
Desde `web`: `npm test` (**38 pruebas**) y `npm run build`. El worker se prueba con canales/temporizadores simulados para fallos y plazos.

Con Vite iniciado en un puerto libre (no detener procesos ajenos):

```sh
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5174/
```

Requiere `playwright-cli` y Chromium/Chrome. Usa un perfil aislado; las capturas y descargas quedan en `web/.playwright-cli/` (ignorado).
Comprueba 32 comparaciones CPython/Pyodide, C2, O1/O0, O3 y obligaciones, Unicode/multilínea/EOF, transferencia desde la demo,
corrección, fases sin recompilar, archivos descargados byte a byte, importación UTF-8/CRLF, recarga, atrás/adelante, ruta desconocida,
fallo real de descarga de Pyodide con recuperación, cambios durante la carga, ediciones rápidas, ambos temas y alternancia móvil/teclado.
La suite `content.js` añade acceso directo a catálogo/detalle y artículos/anclas, apertura y compilación válida, ejercicio
NULL con selección/corrección real, consulta sin alterar documento, recuperación de borrador exacto con O0/IR,
artículo → ejemplo → estudio, copias independientes, atrás/adelante, slugs/rutas desconocidos, límite de ocho y fallo de cuota.
Captura índices y detalles de ejemplos/docs en 1440×1000 y 390×844, en ambos temas; verifica teclado, foco y ausencia de desbordamiento.
También comprueba que entrar al catálogo no descarga el editor ni Python.
Las capturas se revisan visualmente; las pruebas no sustituyen una evaluación de usabilidad. También se comprobó el acceso directo a
`/estudio` con `vite preview` (puerto 5184), compilación real y Python descargable; consola sin errores ni advertencias.

Para repetir el recorrido de contenido sobre el **build servido**, sin las importaciones de módulos dev que necesitan
las suites históricas:

```sh
# web/, en un puerto libre
npm run preview -- --host 127.0.0.1 --port 5185
# raíz
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5185/ --content-only
```

Esta opción no sustituye la suite completa de desarrollo; añade verificación real de rutas directas y compilación en producción.

## Pendiente

W1 queda **parcial**: pasos A, B y E implementados; otros requisitos de su definición siguen pendientes (ver el paso E). W4 esencial implementado; las sugerencias semánticas siguen pendientes.
Paso C/W2 implementa AST/FLOW y comparación de IR. W3 (servicio HTTP, bindings y ejecución Polars con datos) se implementa en el paso D descrito al final.
No hay cuentas, colaboración, persistencia remota ni editor por bloques.


## Paso C: estructura, FLOW y comparación de IR

`src/components/inspectors/` adapta los artefactos reales del contrato 4. `Inspector` es una selección de UI,
independiente de los seis `Format` del compilador; FLOW consume `ast` y Esquemas consume `schemas`.
No cambia el núcleo, la semántica, el puente ni el protocolo. No añade dependencias al proyecto.
Los componentes de inspección y CodeMirror se cargan en diferido; leer docs/ejemplos no carga sus módulos ni Pyodide.

- **AST:** jerarquía expandible con propiedades, selección de nodos con span, texto compacto y JSON completo con posiciones.
  No reconstruye declaraciones a partir del fuente. Los artefactos bloqueados/no solicitados explican su estado.
- **FLOW:** declaraciones y cadenas originales del AST, separadas por pipeline. Distingue SOURCE/INPUT/STEP/USE/OUTPUT/SINK,
  operaciones y puertos de JOIN y de los INPUT/OUTPUT del pipeline usado. Disposición determinista por capas,
  tamaño según el contenido, desplazamiento interno y alternativa de lista accesible. No edita conexiones.
  Una estructura inválida sigue mostrando su AST y enlaces; una disposición no resuelta se identifica sin corregir el programa.
- **IR:** compara original/optimizada de la misma respuesta. `origin` permite conservar la procedencia de fusiones;
  no se relacionan revisiones por nombre. Conservado/cambiado/eliminado describe diferencias de estructura y presencia
  en la IR final, sin atribuirlas a un pase que no emite traza. Sin procedencia suficiente se indica falta de correspondencia.
  En móvil se apilan original y optimizada por nodo; permanecen las representaciones textuales completas.
  La pestaña interna **Evidencia O1/O3** evita recorrer todos los nodos para encontrar las pruebas emitidas.
- **Esquemas:** `schemas` de la IR original, por pipeline/nodo/puerto, con conocimiento completo/parcial, tipos desconocidos,
  dtype Null (`types=[]`), nulabilidad y ausencias conocidas. No es un esquema observado ni inferencia sobre archivos reales.
- **Rangos:** hechos, límites, procedencia y reescrituras originales de `range_facts`/`range_rewrites`.
  Los hechos se identifican como instantáneas intermedias del pase de rangos; no se presentan como estado final.
- **JOIN:** declaración VERIFY, prueba estática emitida, consumidores SELECT, dependencias retenidas y obligaciones
  dinámicas de `join_rewrites`. CHECK_JOIN conserva ambas entradas. VERIFY MANY_TO_ONE también exige validación en O0;
  el navegador no ejecuta esa validación. No hay trazas de constantes/filtros/muertos ni métricas de velocidad nuevas.

Un botón de fuente convierte el span del compilador con el mismo adaptador Unicode → UTF-16 de los diagnósticos;
selecciona rangos multilínea y EOF en el CodeMirror existente. Conexiones FLOW seleccionan su sentencia original completa.
Los nodos fusionados ofrecen cada origen original. No existe mapa Python generado → DSL. Cambiar inspector, pipeline,
subvista o nodo no recompila. Una compilación por revisión/pases solicita todos los artefactos. Solo texto/nombre/pases
crean revisión; los resultados antiguos conservan su rótulo y bloquean selección y descarga Python. Al hacer clic se
vuelve a comprobar el documento/revisión actuales, además de deshabilitar el botón.

**Pases:** Predeterminados envía `null`; O0 envía `[]`; Personalizados envía una lista explícita, incluso si coincide
con los cinco predeterminados. Las casillas añaden al final y Subir/Bajar modifica el orden enviado, que se muestra junto
al selector y en IR con los pases aplicados que devolvió el núcleo. No se ordena silenciosamente al restaurar.
Se mantiene `cauce-workspace-v1`: sus campos ya admitían listas y orden, sin cambios de esquema ni migración necesaria.
Los borradores previos con cualquiera de los seis inspectores históricos siguen restaurándose; se admiten además FLOW/Esquemas.
Se conservan límites, borradores anteriores, avisos de cuota, revisión y descarga exclusiva de Python vigente.

`npm test` incluye adaptadores contra artefactos generados en el momento por `.venv/bin/python` desde la raíz del proyecto;
requiere ese entorno además de Node. Comprueba ramas, múltiples pipelines y puertos USE, JOIN, ciclos parciales,
O0/procedencia/fusiones, evidencia real, restauración v1 y selección Unicode/revisiones.
`verify_browser.py` conserva analysis/workspace/content y añade `inspectors.js`: ventas AST→fuente, riesgo/USE,
JOIN left/right/SELECT/obligaciones, rangos antes/después/pruebas, null→personalizados→O0→recarga, documentación sin pérdida,
Unicode multilínea, revisión antigua bloqueada, errores sintácticos/estructurales/semánticos y corrección,
exploración sin mensajes al worker ni recrear CodeMirror, teclado, ambos temas y móvil.
La descarga de Python con `rangos,constantes` se compara byte a byte con CPython, además de las descargas históricas.

El recorrido nuevo también funciona sobre **vite preview**, sin importar módulos de `/src/`:

```sh
# web/, después del build; elegir puertos libres
npm run preview -- --host 127.0.0.1 --port 5194 --strictPort
# raíz
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5194/ --inspectors-only
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5194/ --content-only
```

Paso C/W2 entregado. W1 sigue parcial por `/evaluacion` y otros requisitos; W3/servicio, datasets, ejecución,
resultados y constructor visual siguen fuera de esta entrega. La siguiente entrega es D, integración de ejecución.

Para enteros fuera del rango seguro de JavaScript, el inspector advierte el posible redondeo del JSON y
remite a AST/IR textuales producidos en Python; no certifica igualdad estructurada para esos nodos ni
imprime un límite de rangos redondeado como exacto. Los decimales del AST ya llegan como texto.

## Paso D: servicio privado y resultados reales

La entrega D añade ejecución explícita al estudio mediante `service/` (FastAPI/Pydantic/Uvicorn), runner subprocess, SQLite y archivos temporales. **Compilar sigue siendo local** e independiente de la API. Ejecutar envía el programa y opciones al servicio, vuelve a compilar allí y valida datasets/contratos con PolarsRuntime. No hay uploads ni despliegue público.

Desde la raíz: instalar `requirements-service.txt`, ejecutar `.venv/bin/python -m service.prepare` y arrancar `.venv/bin/python -m uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log`. Vite dev/preview redirige `/api` a ese puerto; `CAUCE_API_TARGET` permite elegir otro. Después de `npm run build`, la misma API sirve `web/dist` y las rutas SPA, con 404 reales de assets/API. `docker compose --profile web up --build cauce` prepara y sirve ambos bajo loopback con volumen local.

Resultados permite elegir pipeline y bindings `pipeline.declaración → dataset@versión`, ejecutar, cancelar, elegir salida, paginar hasta 100 filas, consultar esquema observado, graficar números finitos de la página y descargar archivos. SOURCE/INPUT/OUTPUT/USE y VERIFY conservan los contratos del núcleo. OUTPUT se materializa en Parquet; SINK conserva CSV/Parquet/DuckDB. Decimales y enteros grandes llegan como texto exacto; NULL, fechas y no finitos tienen representación explícita.

JOIN está incluido sin preparar datos. `service.prepare` reutiliza el generador canónico para ventas/riesgo, prepara rangos con sus propias columnas y un dataset de duplicados para fallo intencional. La disponibilidad procede de capacidades: no basta con que un ejemplo compile. Pases null/[]/listas y su orden se conservan. La API HTTP 1 y el análisis JSON 4 son contratos distintos; `scripts/gen_http.py` genera tipos TS/OpenAPI y `--check` detecta deriva.

Cada trabajo pertenece a fuente/revisión/pases/pipeline/bindings/hash de datasets. Editar lo marca anterior; navegar conserva su referencia en memoria, mientras el sondeo solo funciona en el estudio visible y con trabajo activo. Recargar pierde referencia y bindings, conserva el documento v1 y no cancela el proceso. No hay tablas/datasets en localStorage. Archivo y estado caducan por separado; el servicio limpia archivos a la hora y elimina el tombstone una hora después. Reiniciar marca trabajos interrumpidos y limpia huérfanos, sin reanudar.

Límites: 30 s, un activo y cuatro posiciones adicionales, RSS 512 MiB muestreado cada 50 ms, 16 MiB de entradas, 16 MiB por archivo/32 MiB por trabajo, 256 MiB de instancia y 128 registros; 1 millón de filas/128 columnas por salida. Son protecciones de demo, con posibles sobrepasos entre muestras. No hay sandbox de red/host ni transacción global. La instancia está limitada a uso local/privado.

Comandos, contrato, datasets, aislamiento y verificación detallada: [servicio_ejecucion.md](../docs/servicio_ejecucion.md). Para repetir D con `playwright-cli`, arrancar otra API con `CAUCE_STORAGE=data/cauce-timeout CAUCE_TIMEOUT=0.02` en 8018 y ejecutar `verify_browser.py --url URL --execution-only --timeout-api http://127.0.0.1:8018`. Funciona sobre Vite y sobre el build servido, sin `/src/`. Las suites históricas siguen ejecutándose con el comando sin `--execution-only`.

Paso D/W3 incorpora el recorrido esencial real; W1 global sigue parcial por `/evaluacion` y otros requisitos pendientes. Los apartados históricos anteriores describen su entrega concreta; este apartado y la guía del servicio describen la ejecución vigente.

Verificación final D: **157 Python** (también en Docker), **38 web**, contenido/OpenAPI vigentes, demos regeneradas y builds web/Docker. `playwright-cli` conservó A/B/C y las 32 comparaciones en Vite 5177. D pasó en Vite, build servido por FastAPI 8017 y contenedor local 8019; contenido e inspectores también pasaron en el contenedor, sin `/src/`. Incluye descarga contra Python, varias salidas, USE, JOIN válido/fallido en O0/O3, edición durante running, cancelación, timeout real, API desconectada con Pyodide operativo, vacío, navegación, recarga v1, foco y ambos temas/móvil. Un intento de inspectores falló por descarga externa de Pyodide; la repetición íntegra pasó. Las capturas se revisaron visualmente. Detalle y comandos en la guía del servicio.

## Paso E: `/evaluacion` con evidencia C5 publicada

Página de lectura de la campaña **histórica** `representativa` (11 de noviembre de 2026, revisión medida
`efe13996d920`). La página lo indica al principio: no mide el programa del estudio ni el HEAD que la sirve.

- **Fuente de verdad:** instantánea versionada `public/evidencia/c5-representativa/` (siete archivos autorizados
  por `content/evaluation.json` y `manifest.json`). Se sirve tal cual en `/evidencia/c5-representativa/` para las
  descargas; `metadata.public.json` es la única versión depurada (sin la ruta local del intérprete) y el manifiesto
  declara los hashes publicado y original. `benchmarks/results/` sigue ignorado y no hace falta para el build.
- **Generación:** `scripts/gen_evaluation.py` valida hashes, esquemas, celdas y recálculos con
  `benchmarks/evidence.py` y escribe `src/evaluation/generated.json` (determinista). `--check` detecta deriva;
  `--originals DIR` vuelve a comprobar los originales si existen en el equipo. Nunca se editan cifras a mano.
- **Código:** `pages/EvaluationPage.tsx` (diferida), `evaluation/model.ts` (URL, selección por celda comparable,
  regla de lectura, escala) y `evaluation/DispersionChart.tsx` (SVG propio, sin dependencias nuevas). Si el chunk
  no llega, se muestra un error con Reintentar; una celda incompleta muestra un aviso, nunca valores aproximados.
- **Interpretación:** compilación sin filas/escenario ni manual; razón O0/config dentro de la misma celda y escenario;
  `final_flags_none` explicado como flags solo en materializaciones finales; columna «Transforma la IR» y regla
  descriptiva de lectura (no significancia); JOIN separa declaración, prueba estática, obligaciones dinámicas y tiempo
  observado; reducción de nodos ≠ tiempo; LOC con helpers compartidos aparte y sin inferir legibilidad.
- **URL:** `?fase=ejecucion|compilacion&workload=…&filas=…&escenario=…&config=…`. Valores inválidos se ignoran con
  aviso; los filtros reemplazan la entrada del historial y los casos destacados añaden una, así atrás/adelante recupera
  la selección. O0 queda siempre como referencia visible.
- **Aislamiento:** no importa CodeMirror, Pyodide, el worker ni el cliente de ejecución; no consulta la API ni escribe
  `cauce-workspace-v1`. FastAPI devuelve 404 reales bajo `/evidencia/` (no fallback SPA); `nginx.conf` igual.
- **Accesibilidad:** tablas con caption y encabezados, regiones desplazables enfocables, alternativa tabular del gráfico
  y etiquetas por fila (no depende del color), objetivos de 44 px, foco visible, ambos temas y movimiento reducido.

Verificación con `playwright-cli` (`tests/browser/evaluation.js`, incluida en la suite completa y en
`verify_browser.py --evaluation-only`): acceso directo y título; ausencia de editor/Python/ejecución y de peticiones
`/api`; tabla comparada con `summary.csv` servido (valores exactos y redondeo) en ejecución, compilación, ambos
escenarios y tres tamaños; mejora observada (join), sin mejora (rangos), abstención (control_join) y evidencia JOIN;
URL inválida; atrás/adelante; descarga de los ocho archivos y SHA-256 comparado en Python con el manifiesto, además
de la verificación en el navegador; teclado (flechas en radios, foco en la tabla); 1440×1000 y 390×844 en claro/oscuro
con movimiento reducido, sin desbordamiento global; evaluación → estudio → docs → ejemplos → atrás a la evaluación con
filtros recuperados y el documento/pases personalizados intactos (localStorage idéntico); API abortada.

Ejecutado en Vite (5201, con API 8021 y timeout real 8022), build servido por FastAPI (8021) y contenedor Docker (8023):
evaluación, contenido, inspectores y D completos en los tres; la suite histórica completa con las 32 comparaciones
CPython/Pyodide en Vite. **170 pruebas Python** (también en Docker, 2 omitidas allí por falta de `.git` y de originales),
**45 web**, `gen_content/gen_http/gen_evaluation --check`, demos regeneradas y builds web/Docker.

**W1 sigue parcial.** Pendientes: ajuste de tamaño editor/inspector, enlaces internos `/estudio?vista=…`, sugerencias
semánticas (W4), tutorial CSV → resultado y actualización de `lenguaje.md`/`backend_polars.md`, evaluación con usuarios
y verificación del fallback en el alojamiento que se elija. No hay despliegue público ni constructor por bloques.
