# Cauce: estado real y plan de desarrollo

Fecha de revisión: **11 de noviembre de 2026**.

Este plan parte del código actual de `etl_dsl/`, `tests/` y `web/`, y lo contrasta con [el enunciado](Enunciado_DSL.md). Cubre el compilador y la continuación de la web. C1, C2 y C3 están implementados; las siguientes entregas continúan pendientes.

Ampliación del plan: arquitectura de conexión, páginas adicionales y evaluación de edición visual, tomando como referencia el proyecto local `csharp-x86-compi/`. Se mantiene la libertad de adaptar sus ideas al dominio ETL. Esta ampliación documenta decisiones; no implementa todavía las páginas ni el editor por bloques.

La [definición de arquitectura de la aplicación](arquitectura_aplicacion.md) concreta API, procesos, contratos, persistencia y decisiones pendientes. Sus rutas `/api/v1` y su ciclo de trabajos sustituyen los nombres tentativos iniciales.

**Leyenda:** ✅ implementado; 🟡 parcial; ⬜ pendiente. «Implementado» describe lo observado en el repositorio, no garantiza todos los casos posibles.

## 1. Estado actual del compilador

| Área | Estado | Qué existe y dónde |
|---|---|---|
| Análisis léxico y sintáctico | ✅ | Gramática ETL-DSL v0.2, Lark LALR, scanner y posiciones: `etl_dsl/grammar.lark`, `scanner.py`, `parser.py`, `token.py`. |
| AST | ✅ | Nodos inmutables, intervalos de origen, construcción desde Lark y recorridos: `ast.py`, `visitor.py`. |
| Validación estructural | ✅ | Duplicados, enlaces y puertos, entradas requeridas, ciclos de `FLOW` y `USE`, aridad, uso de `NULL` y condiciones de JOIN: `validation.py`. |
| Diagnósticos | 🟡 | Código, mensaje, fase, severidad, archivo e intervalo completo; se transportan como objetos hasta CodeMirror. Queda mejorar sugerencias. |
| API de análisis compartida (C1) | ✅ | `etl_dsl.analyze` recibe texto sin archivos temporales y entrega artefactos seleccionables, errores parciales y contrato JSON versionado; CLI, puente web y demos la consumen. |
| Tipos (C2) | ✅ | Inferencia conservadora de esquemas, tipos y nulabilidad en las diez operaciones; contratos OUTPUT/USE. Se mantienen chequeos de datos en ejecución. |
| IR | ✅ | DAG por pipeline, orden topológico, puertos resueltos, origen de los nodos y formato textual: `ir.py`. Las expresiones reutilizan el AST. |
| Anotaciones semánticas de la IR | 🟡 | Artefacto `schemas` de la IR original; hechos y pruebas O1 en `ir_after.module`. Unicidad y referencias siguen pendientes. |
| Optimizaciones actuales | ✅ | `constantes`, `rangos`, `filtros` y `muertos`; selección por `--pases` y desactivación con `-O0`: `passes.py`. |
| Optimizaciones basadas en hechos del dominio | 🟡 | O1 `rangos` implementado con pruebas y procedencia. O3 de eliminación de joins sigue pendiente. Los tres pases clásicos se agrupan como O4. |
| Generación de código | ✅ | Python legible con Polars desde la IR, expresiones y composición mediante `USE`: `backend.py`. |
| Operaciones | ✅ | `FILTER`, `SELECT`, `DERIVE`, `AGGREGATE`, `JOIN`, `SORT`, `DISTINCT`, `RENAME`, `FILL_NULL`, `DROP_NULLS`. |
| Conectores | ✅ | Lectura CSV, Parquet, SQLite y DuckDB; escritura CSV, Parquet y DuckDB: `runtime.py`. DuckDB es un conector; las transformaciones usan Polars. |
| Ejecución | ✅ | `LazyFrame`, selección de pipelines, entradas externas mediante API Python y comprobaciones en ejecución. |
| CLI | ✅ | Compilación individual y por carpetas, seis formatos, ejecución, selección de pases, rutas base y continuación del lote tras errores: `main.py`. |
| Pruebas y entorno | ✅ | Suite `unittest`, dependencias, Docker y datos de demostración. Tras C3 pasan **105 pruebas Python**, más 4 del adaptador web. |
| Evaluación experimental | ⬜ | No se identificó un arnés de benchmarks, baselines manuales y resultados estadísticos reproducibles entre los archivos revisados. |

**Distinción importante:** el compilador ya funciona de punta a punta por terminal. La brecha principal está en verificar propiedades de los datos antes de ejecutarlos y usarlas para optimizar.

## 2. Estado actual de la web

La web ya contiene un estudio funcional, además del landing. Tras C1 se verificó también su recorrido interactivo con `playwright-cli`: Pyodide, paridad de resultados, diagnósticos y corrección en CodeMirror. Esta comprobación funcional no es una auditoría visual del diseño.

| Funcionalidad | Estado | Evidencia y límite actual |
|---|---|---|
| Landing Cauce | ✅ | Secciones de producto, errores, optimizador, lenguaje, historia, tecnologías y preguntas: `web/src/App.tsx` y `components/`. |
| Marca y temas | ✅ | Tokens, tipografía y cambio claro/oscuro implementados en `styles/brand.css`, `index.css` y `lib/theme.ts`. |
| Editor | ✅ | CodeMirror 6, resaltado, sugerencias de vocabulario, diagnósticos y atajo para compilar: `src/editor/`. |
| Compilación real en navegador | ✅ | El mismo paquete Python corre con Pyodide y Lark dentro de un Web Worker: `src/compiler/worker.ts`. |
| Resultados iniciales | ✅ | Salidas precalculadas por el compilador real; puente compartido con el navegador: `studio.py`, `scripts/gen_compiled.py`. |
| Inspección de fases | ✅ | Resultado de validación, tokens, árbol concreto, AST, IR y Python como texto. La IR incluye antes/después cuando hay pases activos. |
| Compilación al editar | ✅ | Tras cargar Python, espera de 320 ms; ejemplos editables, restauración y switch de optimización: `Studio.tsx`. |
| Demostración de pases | ✅ | Comparación progresiva de constantes, filtros y pasos muertos: `Optimizer.tsx`. |
| AST y FLOW como gráficos | ⬜ | Se muestran representaciones textuales; falta navegación visual entre nodos y código. |
| Estudio en pantalla completa | ⬜ | El editor está integrado como sección final del landing. |
| Ejecución y resultados | ⬜ | La web compila, pero no ejecuta Polars ni lee datasets; no hay tabla de resultados de ejecución. |
| Archivos y persistencia del trabajo | ⬜ | Las ediciones viven en el estado React; falta importar/exportar programas y restaurar borradores al recargar. |
| Build de producción | ✅ | `npm run build` pasó durante esta revisión. Esto no verifica la descarga de Pyodide ni su funcionamiento en una sesión real. |

### Decisiones que se mantienen

- Vite + React + TypeScript + Tailwind; CodeMirror 6 como editor.
- Compilación en navegador con Pyodide, conservando la carga diferida.
- Marca y tokens actuales; continuar el estudio sobre el diseño existente.
- AST, IR y Python obtenidos del compilador real, incluyendo las demostraciones.
- Sintaxis implementada `PIPELINE` / `STEP` / `FLOW` y extensión `.etl`.

El [plan inicial](planificacion.md) contiene decisiones anteriores: sintaxis en español, `.fetl`, Monaco y FastAPI. Debe leerse como historial, no como descripción del producto actual.

## 3. Prioridades

| Prioridad | Objetivo | Motivo |
|---|---|---|
| P0 | Análisis estático de esquemas, tipos y nulabilidad | Completar la verificación semántica del dominio exigida por el enunciado. |
| P0 | Dos optimizaciones del dominio con condiciones de corrección y mediciones | El enunciado exige al menos dos. Hay que justificar qué pases satisfacen ese requisito; no asumir que tres pases clásicos lo resuelven. |
| P1 | Contrato estructurado del compilador y estudio ampliado | Hacer que las fases y los errores sean explorables y coherentes. |
| P1 | Ejecución integrada y tabla de resultados | Completar el recorrido del entorno solicitado para la bonificación. |
| P1 | Benchmarks, documentación y reporte | Convertir la implementación en una entrega reproducible y defendible. |
| P2 | Gráficos avanzados, autocompletado contextual y comodidades | Mejorar la experiencia después de completar el recorrido funcional. |

## 4. Plan de implementación del compilador

### C1. API de análisis compartida y resultados estructurados — P1

- [x] Crear una API pública en `etl_dsl/` que reciba texto, nombre y pases, sin depender de `_analyze` ni de escribir un archivo temporal.
- [x] Devolver diagnósticos, AST, IR original, IR optimizada, Python y pases aplicados. Permitir solicitar artefactos para evitar trabajo innecesario.
- [x] Serializar diagnósticos con código, mensaje, severidad e intervalo completo; preservar las posiciones del AST aunque la vista decida ocultarlas.
- [x] Representar fallos por fase: un error sintáctico deja disponibles los artefactos anteriores que se hayan podido producir, sin simular un AST válido.
- [x] Hacer que CLI, `studio.py` y generador de demos consuman la misma API; mantener los formatos de texto existentes.

**Archivos:** nuevo módulo de análisis, `diagnostics.py`, `main.py`, `web/src/compiler/{studio.py,types.ts,client.ts,worker.ts}`.

**Criterio de cierre:** el mismo programa produce diagnósticos y artefactos equivalentes en CLI y puente web; CodeMirror recibe intervalos estructurados sin extraerlos de stderr con una expresión regular.

**Cerrado:** implementación en `etl_dsl/analysis.py`; contrato y comandos de verificación en [api_analisis.md](api_analisis.md). Se verificaron 70 pruebas Python, 4 pruebas del adaptador de rangos, build web y 32 comparaciones CPython/Pyodide mediante `playwright-cli`, además de corregir un diagnóstico real y comprobar rangos Unicode multilínea en CodeMirror. C2 se completó en la entrega siguiente; el servicio de ejecución sigue pendiente.

### C2. Análisis estático de esquemas y tipos — P0

- [x] Agregar un módulo semántico que recorra el DAG en orden topológico y asocie a cada salida un esquema: columnas, tipo y nulabilidad.
- [x] Partir de contratos `INPUT` y `SOURCE`; conservar un estado explícito de esquema desconocido cuando no haya contrato. Compilar debe seguir sin leer los archivos de datos.
- [x] Comprobar referencias de columnas, operandos numéricos, predicados booleanos, argumentos de funciones y agregaciones.
- [x] Propagar esquemas por selección, renombrado y columnas derivadas. Respetar el alcance de asignaciones que ya tiene el backend.
- [x] Modelar nulabilidad tras `FILL_NULL`, `DROP_NULLS` y joins externos; comprobar claves de JOIN, columnas ambiguas y contratos de `OUTPUT` y `USE`.
- [x] Ejecutar la comprobación antes de eliminar nodos para que un pase no oculte errores del programa original.
- [x] Conservar comprobaciones en ejecución para propiedades que no puedan demostrarse estáticamente.

**Archivos:** nuevo módulo semántico, `type.py`, `ir.py`, `backend.py`, `main.py`; pruebas semánticas nuevas.

**Criterio de cierre:** con un esquema conocido, `WHERE monto + 1` y una referencia a una columna inexistente fallan al compilar, con posición y explicación; un esquema desconocido no se interpreta como prueba de validez.

**Cerrado:** `etl_dsl/semantic.py` comparte reglas entre `analyze`, `build_ir` y `compile_program`; cubre las diez operaciones, esquemas parciales, nulabilidad y composición especializada de USE. El artefacto `schemas` se publica con contrato JSON 2. Ver [reglas y límites](semantica_estatica.md). Verificado con 88 pruebas Python, 4 web, build y Pyodide mediante `playwright-cli` (32 comparaciones y dos casos estáticos adicionales). No incluye C3/C4.

### C3. Hechos del dominio y optimización O1 de rangos — P0

- [x] Definir hechos conservadores por columna: intervalo, nulabilidad y procedencia de la garantía. Comenzar por hechos deducidos de filtros y literales existentes.
- [x] Propagarlos por filtros, selección y renombrado; invalidarlos cuando `DERIVE` sustituya una columna y ensancharlos conservadoramente en uniones y agregaciones.
- [x] Crear un pase `rangos`: si un filtro previo garantiza `monto >= 100`, eliminar un filtro posterior `monto >= 0` cuando esa implicación sea demostrable.
- [x] Manejar límites abiertos/cerrados y `NULL`; ante una contradicción, conservar inicialmente el filtro que produce vacío hasta tener una representación de relación vacía con esquema correcto.
- [x] Registrar qué hecho permitió la reescritura y qué nodos cambiaron.

**Dependencia:** C2. **Archivos:** módulo de hechos, `passes.py`, anotaciones de IR y pruebas.

**Criterio de cierre:** equivalencia con `-O0` en límites, nulos, ramas compartidas y columnas redefinidas; el pase solo elimina condiciones demostradas.

**Cerrado:** `facts.py` implementa hechos inmutables y el pase `rangos`, predeterminado entre `constantes` y `filtros`. Incluye procedencia, pruebas estructuradas y comentarios en IR (contrato JSON 3). Las diez operaciones y USE tienen transferencia conservadora; los límites y abstenciones están en [optimizacion_rangos.md](optimizacion_rangos.md). Verificación: 105 pruebas Python, 4 web, build, demos y Pyodide con `playwright-cli`. No incluye C4, W2 gráfico ni mediciones C5.

### C4. Optimización O3 de joins con garantías verificables — P0

- [ ] Definir cómo expresar y comprobar unicidad y referencias entre tablas. Son una extensión nueva: no existen hoy declaraciones de estas garantías en la gramática.
- [ ] Separar restricciones declaradas de hechos comprobados; una anotación sin validar no basta para cambiar resultados.
- [ ] Analizar las columnas usadas por todos los consumidores de un JOIN.
- [ ] Eliminar un `INNER JOIN` únicamente si no se usa ninguna columna del lado eliminado y se garantiza una coincidencia exacta por fila: referencia total, clave única y tratamiento compatible de nulos.
- [ ] Mantener las comprobaciones que sustentan esas garantías, incluso cuando el JOIN se elimine; no borrar lecturas o validaciones con efectos observables sin justificarlo.
- [ ] No generalizar inicialmente a joins externos ni a claves compuestas sin pruebas específicas.

**Dependencias:** C2 y modelo de hechos de C3. **Archivos:** gramática/AST si se agregan contratos, análisis semántico, runtime, IR y pases.

**Criterio de cierre:** equivalencia con duplicados, referencias ausentes y nulos; esos casos deben impedir la eliminación o hacer fallar el contrato. Si O3 excede el alcance, seleccionar y justificar otra segunda optimización del dominio antes de dar el requisito por cubierto.

### C5. Evaluación reproducible — P1

- [ ] Crear `benchmarks/` con datos de semilla fija, programas `.etl` y versiones Polars escritas a mano.
- [ ] Comparar `-O0`, cada pase por separado, combinación completa y baseline manual; verificar primero igualdad de resultados.
- [ ] Separar tiempo de compilación y ejecución; documentar calentamiento, número de repeticiones, mediana, dispersión y entorno.
- [ ] Controlar y documentar las optimizaciones de Polars para distinguir su efecto del de nuestros pases. No prometer mejoras de tiempo por una reducción de nodos.
- [ ] Exportar resultados a CSV y generar tablas/gráficos para expresividad, rendimiento, impacto por pase y detección de errores.

**Criterio de cierre:** un comando reproduce datos y mediciones; los resultados reportados incluyen variación y limitaciones.

## 5. Plan de continuación de la web

### W1. Estudio ampliado — P1

- [ ] Extraer el área de trabajo de `Studio.tsx` a componentes reutilizables y ofrecer una vista ampliada enlazada desde el landing.
- [ ] Implementar la ruta `/estudio` y las páginas auxiliares descritas en la sección 9, conservando un único documento activo entre vistas del estudio.
- [ ] Distribuir editor y resultados en paneles adaptables, con selección de fase, estado de compilación y acceso por teclado.
- [ ] Mantener visibles los errores junto al editor; permitir pulsar un diagnóstico para seleccionar su intervalo.
- [ ] Incorporar importación/exportación `.etl`, descarga de Python y borradores locales versionados.
- [ ] Conservar la carga diferida de editor y Python.

**Criterio de cierre:** abrir el estudio, editar, compilar, corregir un error y descargar el código sin perder el borrador al recargar.

### W2. Fases y optimizaciones explorables — P1/P2

- [ ] Consumir los artefactos estructurados de C1; mantener texto/JSON como vista alternativa.
- [ ] Presentar IR original y optimizada lado a lado, con selector de pases individuales y explicación de cada transformación.
- [ ] Agregar AST expandible y DAG de FLOW, diferenciando pipelines, puertos, entradas y salidas. El grafo dibujado es mejora posterior; las vistas textuales ya existen.
- [ ] Enlazar nodos con posiciones del editor mediante `span` y `origin`, incluyendo los nodos fusionados.
- [ ] Añadir esquemas y hechos inferidos cuando C2/C3 estén disponibles.

**Criterio de cierre:** una modificación del programa actualiza ambas IR y su Python; seleccionar un nodo lleva al fragmento que lo originó.

### W3. Ejecución y resultados — P1

**Decisión:** mantener compilación en navegador y agregar un servicio Python para la ejecución real. Así se reutiliza `PolarsRuntime` y sus conectores sin condicionar la entrega a portar Polars/DuckDB al navegador. La ejecución enteramente local con WebAssembly queda como investigación futura.

- [ ] Implementar el servicio descrito en la sección 8, comenzando por datasets de ejemplo y conservando la compilación local independiente del servicio.
- [ ] Ejecutar cada solicitud en un proceso aislado con directorio temporal y límites de tiempo/memoria. Para exposición pública, usar además aislamiento de sistema de archivos y red mediante un contenedor o mecanismo equivalente; un proceso separado por sí solo no restringe archivos del host.
- [ ] Aceptar fuente `.etl`, opciones y referencias a datasets autorizados; recompilar en el servidor. No recibir Python arbitrario para ejecutarlo.
- [ ] Añadir selección de pipeline, botón Ejecutar, estados y errores; reutilizar el código generado y sus contratos.
- [ ] Devolver vista previa limitada de filas, esquema, nulos, duración y artefactos de `SINK`; permitir descargar resultados completos sin enviar todas las filas a la interfaz.
- [ ] Mostrar tabla y un gráfico sencillo cuando las columnas seleccionadas lo permitan. Separar claramente datos de ejemplo, salida precalculada y resultado recién ejecutado.
- [ ] Actualizar el texto actual «tus datos no salen de tu equipo»: compilar ocurre localmente; ejecutar envía el programa y, cuando se habiliten archivos propios, los datos seleccionados al servicio.

**Criterio de cierre:** ejecutar un ejemplo genera filas y un archivo real; un archivo ausente o un contrato inválido produce un error comprensible; la interfaz sigue respondiendo durante la ejecución.

### W4. Robustez del editor y worker — P1/P2

- [ ] Ignorar resultados de solicitudes antiguas al cambiar texto, formato o pases; agrupar trabajo pendiente para no compilar todas las versiones intermedias.
- [ ] Manejar `worker.onerror` y errores de mensajes, rechazar promesas pendientes y permitir reiniciar el worker.
- [ ] Incorporar tiempo máximo y reinicio para solicitudes bloqueadas; el identificador de solicitud debe llegar hasta la actualización de la vista.
- [ ] Probar pérdida de red al cargar Python, recuperación, ediciones rápidas y cambios de ejemplo durante la carga.
- [ ] Mejorar después las sugerencias con columnas, pasos y puertos disponibles a partir del análisis semántico.

**Criterio de cierre:** la salida visible corresponde siempre a la versión actual o está marcada como desactualizada; los fallos del worker no dejan la aplicación compilando indefinidamente.

## 6. Orden recomendado y entregas verificables

| Entrega | Trabajo | Evidencia de cierre |
|---|---|---|
| 1 | C1 + estructura de W1 | API común y estudio ampliado mostrando las fases que ya existen. |
| 2 | C2 | Errores de columnas/tipos detectados antes de ejecutar y señalados en el editor. |
| 3 | C3 + comparación de W2 | Pase de rangos, pruebas de equivalencia y explicación antes/después. |
| 4 | C4 | Segunda optimización del dominio con garantías comprobadas y contraejemplos cubiertos. |
| 5 | W3 + robustez esencial de W4 | Recorrido completo: editar → compilar → ejecutar → tabla → descargar. |
| 6 | C5 + documentación final | Experimentos reproducibles, referencia actualizada, tutorial, reporte y demo. |

El contrato del servicio y un primer recorrido con un dataset incluido pueden desarrollarse junto con C1. Las páginas deben funcionar con las capacidades actuales, sin esperar a C2–C4: tipos inferidos y pases nuevos se incorporan cuando existan. No se asignan fechas ni responsables nuevos sin conocer la disponibilidad del equipo.

## 7. Pruebas y documentación para cerrar el proyecto

- [x] Suite actual: `.venv/bin/python -m unittest discover` — **105 pruebas, OK**.
- [x] Adaptador de diagnósticos: `cd web && npm test` — **4 pruebas, OK**.
- [x] C1/C2/C3 en navegador: `.venv/bin/python web/scripts/verify_browser.py` — **32 comparaciones CPython/Pyodide, dos casos C2, prueba O1 y recorrido de corrección, OK**.
- [x] Build actual: `cd web && npm run build` — **OK**.
- [x] Agregar pruebas de tipos/esquemas y de propagación de nulabilidad, especialmente en JOIN y `USE`.
- [ ] Probar equivalencia por cada pase nuevo y casos donde debe abstenerse de optimizar.
- [ ] Automatizar el recorrido web: cargar Pyodide, editar, diagnosticar, comparar IR y ejecutar un ejemplo.
- [ ] Verificar el estudio en móvil y escritorio, teclado, foco, temas y movimiento reducido.
- [ ] Comprobar paridad entre CLI, puente y navegador después de cambiar el compilador; regenerar `compiled.json`.
- [ ] Actualizar `docs/lenguaje.md` y `docs/backend_polars.md`; escribir un tutorial desde un CSV hasta un resultado.
- [ ] Preparar reporte LaTeX de 6–10 páginas con evaluación, limitaciones, referencias y declaración de uso de IA.
- [ ] Preparar demo técnica y ensayo de explicación de todas las fases por el equipo.
- [ ] Verificar con el equipo la evidencia de las tres reuniones exigidas para la bonificación; su realización no se puede deducir del código.

**Alcance recomendado:** completar verificación estática, dos optimizaciones justificadas y el recorrido de ejecución. Dejar Excel, LSP, colaboración y visualizaciones avanzadas para después de ese cierre.

## 8. Arquitectura de conexión con el proyecto

### 8.1. Un compilador, dos entornos

Se propone extender la aplicación existente en `web/`. No crear otro frontend ni portar la semántica a TypeScript. `etl_dsl/` sigue siendo la autoridad sobre el lenguaje.

```mermaid
flowchart TD
    Inicio[Landing /] --> Estudio[Estudio /estudio]
    Ejemplos[Ejemplos /ejemplos] --> Estudio
    Docs[Documentación /docs] --> Estudio
    Estudio --> Documento[Documento y revisión activos]
    Documento --> Worker[Web Worker + Pyodide]
    Worker --> Analisis[API Python compartida de etl_dsl]
    Analisis --> Fases[Diagnósticos, AST, IR y Python]
    Fases --> Vistas[Inspectores del estudio]
    Documento -->|Ejecutar explícitamente| Servicio[Servicio Python]
    Servicio --> Recompilar[Validar y compilar con etl_dsl]
    Recompilar --> Runtime[PolarsRuntime en entorno aislado]
    Runtime --> Resultados[Tabla, esquema y archivos de salida]
    Resultados --> Vistas
```

**Conexión concreta:**

1. C1 expone una función de análisis independiente de la CLI. El worker, la CLI y el servicio llaman a esa misma función.
2. El navegador obtiene los fuentes Python como hoy; el servicio utiliza el paquete instalado desde el mismo repositorio. Ambos informan una versión de compilador y de contrato para detectar despliegues incompatibles.
3. El estudio mantiene una revisión del documento. Los artefactos y ejecuciones guardan la revisión, los pases y las versiones de datasets utilizados; un cambio marca lo anterior como desactualizado.
4. Cambiar de inspector no descarta texto, selección, resultados ni posición del editor. No se compila otra vez solo por navegar si los artefactos solicitados ya están disponibles para esa revisión.
5. Ejecutar es una acción explícita. No se leen datos ni se llama al servicio por cada tecla.

### 8.2. Servicio de ejecución propuesto

Agregar `service/` como adaptador HTTP Python delgado. Se propone FastAPI para ese adaptador; el análisis y la ejecución permanecen en `etl_dsl/`. Esta elección nueva aplica al servicio de ejecución y no revierte la decisión de compilar con Pyodide.

| Interfaz propuesta | Responsabilidad |
|---|---|
| `GET /api/v1/capabilities` | Versión de compilador/contrato, conectores habilitados, límites y datasets de ejemplo disponibles. |
| `POST /api/v1/runs` | Recibir fuente, pipeline, pases y bindings de datasets; validar, crear trabajo y devolver identificador. |
| `GET /api/v1/runs/:id` | Estado, diagnósticos, versión analizada y salidas disponibles. |
| `POST /api/v1/runs/:id/cancel` | Solicitar cancelación de un trabajo activo y liberar sus recursos. |
| `GET /api/v1/runs/:id/outputs/:outputId/preview` | Consultar esquema y vista previa acotada de una salida. |
| `GET /api/v1/runs/:id/artifacts/:artifactId` | Descargar exclusivamente un archivo producido por ese trabajo mediante un identificador opaco. |

Los nombres son parte del diseño propuesto, no endpoints existentes. El cliente HTTP debe quedar detrás de `src/execution/client.ts`, separado del cliente de compilación.

- Primer alcance: datasets incluidos y versionados, sin cuentas ni carga pública de archivos. Los bindings identifican una declaración `SOURCE` por pipeline y nombre; el servicio sustituye su ruta por un archivo permitido y conserva las demás opciones validadas.
- Validar todas las rutas de `SOURCE`/`SINK`, incluidas las de pipelines invocados mediante `USE`; los destinos siempre quedan dentro del directorio del trabajo. No interpretar una ruta enviada por el cliente como permiso para leer el host.
- Usar ejecución en segundo plano con sondeo breve mientras la página está activa; no hace falta introducir sockets para el primer recorrido.
- Conservar temporalmente los artefactos con una política de caducidad explícita. Un enlace a una ejecución caducada explica qué ocurrió y ofrece volver a ejecutarla.
- El servicio puede estar desconectado: código, fases, ejemplos y documentación siguen funcionando; solo la ejecución muestra su indisponibilidad.
- La interfaz usa capacidades reales: SQLite solo como lectura, por ejemplo. No anunciar en la web escritura SQLite, que el compilador actual no soporta.

### 8.3. Contratos y organización del frontend

| Pieza propuesta | Contenido |
|---|---|
| `src/pages/LandingPage.tsx` | Composición actual de `App.tsx`; conserva el estudio breve de demostración. |
| `src/pages/StudioPage.tsx` | Área de trabajo completa y documento activo. |
| `src/pages/ExamplesPage.tsx` | Catálogo y detalle de ejemplos. |
| `src/pages/DocsPage.tsx` | Navegación y lectura de documentación. |
| `src/pages/EvaluationPage.tsx` | Metodología y resultados experimentales verificados. |
| `src/workspace/` | Estado de documentos, revisiones, selección y borradores; compartido por todas las vistas del estudio. |
| `src/compiler/` | Contrato de C1 y worker actual; serialización de fases, sin ejecución de datos. |
| `src/execution/` | Cliente HTTP, estados de trabajos, vistas previas y descargas. |
| `src/components/inspectors/` | Tokens, AST, FLOW, IR, optimizaciones, Python y resultados. |

Agregar enrutamiento con carga diferida por página y configurar el hosting para resolver accesos directos a rutas de la aplicación. El código del editor, grafos y estudio no debe descargarse al abrir un artículo. Los parámetros de URL guardan selección de vista/ejemplo, no programas completos ni datos personales. Los borradores pequeños pueden persistirse en almacenamiento local; datasets y resultados grandes no deben guardarse allí.

El contrato debe distinguir `no solicitado`, `disponible`, `bloqueado por error` y `no soportado`. Una fase no implementada no puede aparecer vacía como si hubiera terminado correctamente. La primera versión puede mostrar el AST expandible y la IR actual sin inventar esquemas inferidos ni reportes de pases que el compilador aún no emite.

## 9. Páginas adicionales y cómo implementarlas

### 9.1. Mapa de navegación

| Ruta | Estado | Propósito y prioridad |
|---|---|---|
| `/` | ✅ Composición existente; falta adaptar navegación | Presentación de Cauce y demostración breve. |
| `/estudio` | ⬜ Nueva página, P1 | Crear, inspeccionar y ejecutar un programa. Página principal del compilador. |
| `/ejemplos` y `/ejemplos/:slug` | ⬜ Nuevas páginas, P1 | Elegir un problema ETL y abrir una copia editable. |
| `/docs` y `/docs/:slug` | ⬜ Nuevas páginas, P1 | Aprender a usar el lenguaje y consultar sus reglas. |
| `/evaluacion` | ⬜ Nueva página, P1 tras C5 | Consultar evidencia de expresividad, errores y rendimiento. |
| `/estudio?vista=bloques` | ⬜ Candidata experimental, P2 | Evaluar edición visual más adelante; no forma parte de la implementación aprobada. |

**Decisión de navegación:** fases, datos, optimizaciones y resultados son vistas del mismo estudio, no páginas independientes que obliguen a recargar el programa. Ejemplos, documentación y evaluación sí tienen páginas porque responden a tareas distintas. No se necesita un dashboard de cuentas o proyectos para el compilador actual.

### 9.2. Estudio: `/estudio`

**Usuario y resultado esperado:** una persona que quiere transformar datos o inspeccionar la compilación. Debe poder abrir un ejemplo, editarlo, localizar un error y obtener un resultado real.

**Composición:** barra de documento con ejemplo/importación, estado de guardado, Compilar y Ejecutar; editor como área estable; inspector con vistas seleccionables; diagnósticos accesibles desde cualquier vista. En escritorio, editor e inspector en paralelo con ajuste de tamaño. En móvil, alternancia entre código e inspector sin comprimir ambos en columnas estrechas.

| Vista del estudio | Qué muestra | Implementación sobre el proyecto actual |
|---|---|---|
| Flujo | Grafo de declaraciones y conexiones del pipeline seleccionado. | Derivarlo del AST y `FLOW` originales; mostrar puertos `left/right` y `USE`. No usar la IR optimizada como representación editable del programa. Primero lectura y selección. |
| Fases | Tokens en tabla, árbol concreto y AST expandible. | Usar `scan`, `parse_tree`, AST y posiciones de C1; conservar búsqueda y vista textual. |
| Optimización | IR antes/después, pases elegidos y transformaciones observadas. | Reutilizar las ideas de `Optimizer.tsx` para cualquier documento. Inicialmente diff y recuentos reales; después trazas de pases emitidas por Python. |
| Python | Código generado y descarga. | Consumir `backend.py`; agregar mapa de origen por líneas si se desea selección código ↔ Python. Ese mapa no existe hoy y debe producirlo el generador. |
| Datos | Fuentes del programa, contratos declarados y bindings disponibles. | Extraer declaraciones del AST; unirlas al catálogo autorizado del servicio. Diferenciar contrato declarado, esquema observado e inferido estáticamente. |
| Resultados | Estado de ejecución, tabla, esquema y archivos de salida. | Consumir W3; seleccionar salida si hay varios `SINK`/`OUTPUT`, limitar vista previa y conservar tipos/nulos en la serialización. |

**Enlaces internos:** `/estudio?vista=optimizacion` abre ese inspector; un identificador local de documento puede acompañarlo. Un enlace con identificador local solo se puede restaurar en ese navegador: compartir un trabajo requiere exportar `.etl`; no se promete colaboración o almacenamiento remoto.

**Conexión entre vistas:** seleccionar un nodo enfoca su rango en CodeMirror y su entrada/salida en el inspector. Mantener identificadores de nodos dentro de cada revisión, posiciones completas y `origin` para fusiones; no asumir que esos identificadores sobreviven sin cambios a cualquier edición.

**Estados:** documento nuevo, borrador restaurado, Python cargando, análisis parcial, error por fase, compilación lista, salida desactualizada, servicio desconectado, ejecutando, cancelado, fallido y resultado vacío válido.

**Criterio de cierre:** completar el recorrido con `ventas.etl`, crear un error sintáctico y corregirlo, comparar IR con/sin pases, ejecutar y descargar una salida. Cambiar de vista conserva el documento y ningún resultado antiguo se presenta como actual.

### 9.3. Ejemplos: `/ejemplos` y `/ejemplos/:slug`

**Usuario y resultado esperado:** quien aún no sabe qué escribir. Debe encontrar un caso cercano a su problema y entender qué hace antes de abrirlo.

**Contenido:** ejemplos agrupados por intención: limpieza de nulos, filtros, agregación, joins, reutilización con `USE`, optimizaciones y errores explicados. Cada detalle contiene problema, fuente `.etl`, datasets requeridos, operaciones utilizadas y acción «Abrir en el estudio».

**Implementación:**

- Crear un manifiesto en `src/examples/` con slug estable, título, objetivo, ruta del fuente y requisitos. Reutilizar `scripts/programs/`, `input/` y `demo/` mediante selección explícita; no publicar automáticamente todo archivo del repositorio.
- Guardar expectativas verificables para cada ejemplo: compila, produce determinado diagnóstico o requiere un dataset concreto. Los ejemplos inválidos se identifican como ejercicios de diagnóstico.
- Mantener una sola copia del `.etl`; generar salidas de demostración con el compilador real. Las previsualizaciones precalculadas llevan esa etiqueta y no se confunden con ejecuciones en vivo.
- Abrir una copia en el estudio mediante su slug y el estado compartido. Si hay cambios sin guardar, conservar el borrador anterior antes de abrir el ejemplo nuevo.

**Disponible sin backend:** catálogo, explicación y código. **Requiere W3:** ejecutar sobre sus datasets y obtener resultados actuales.

**Criterio de cierre:** acceder directamente a un detalle, abrirlo en el estudio y comprobar que su código y datasets corresponden al ejemplo seleccionado.

### 9.4. Documentación: `/docs` y `/docs/:slug`

**Usuario y resultado esperado:** quien necesita aprender una operación o resolver un error. Debe llegar de la explicación a un ejemplo ejecutable sin perder su borrador.

**Secciones iniciales:** primeros pasos, estructura `PIPELINE`/`FLOW`, operaciones, funciones y `NULL`, conectores, composición con `USE`, diagnósticos y funcionamiento local/servidor.

**Implementación:**

- Reutilizar contenido vigente de `docs/lenguaje.md` y `docs/backend_polars.md`, con un manifiesto de artículos. Separar tutorial de referencia técnica; no publicar la planificación histórica como manual del lenguaje actual.
- Renderizar el Markdown durante el build y cargar por artículo, con índice, anclas y bloques de código usando el resaltado existente.
- Enlazar fragmentos completos a ejemplos del catálogo. Un fragmento incompleto se etiqueta como tal y no ofrece ejecución directa.
- Enlazar códigos de diagnóstico desde el estudio a su explicación, causa y corrección. El catálogo se mantiene junto a los diagnósticos y se verifica frente a los códigos reales.
- Mostrar claramente compatibilidad y límites: compilación sin datos, ejecución con servicio, tipos verificados actualmente en runtime y conectores de lectura/escritura efectivamente soportados.

**Criterio de cierre:** desde un diagnóstico del estudio se abre su explicación; desde primeros pasos se abre un ejemplo válido; Volver restaura el trabajo anterior.

### 9.5. Evaluación: `/evaluacion`

**Usuario y resultado esperado:** integrante del equipo, docente o persona que quiere comprobar las ventajas del DSL. Debe poder distinguir evidencia experimental de demostraciones ilustrativas.

**Contenido:** metodología, versiones y entorno; comparación DSL/Polars manual; programas con errores; efecto por pase; tablas de tiempos y dispersión; descarga de resultados y enlace al comando reproductor.

**Implementación:** consumir JSON generado desde los resultados de C5 durante el build. Ofrecer filtros por benchmark/tamaño/pase y tabla accesible junto a cada gráfico. Publicar fecha, número de repeticiones y dispersión. La reducción de nodos se etiqueta como tal y nunca como porcentaje de aceleración.

**Dependencia:** C5. Antes de disponer de mediciones, mantener la página fuera de la navegación pública o mostrar únicamente una metodología identificada como pendiente de resultados; no llenar gráficos con datos inventados.

**Criterio de cierre:** cada valor mostrado se rastrea a un archivo de resultados y a un experimento reproducible; un benchmark ausente no aparece con tiempo cero.

### 9.6. Ajustes de la página existente y navegación

- Mantener el landing y su demostración breve. «Abrir el estudio» pasa de `#estudio` a `/estudio`; al abrir desde la demo se transfiere una copia del texto editado y los pases elegidos.
- Añadir accesos a Ejemplos y Documentación; incorporar Evaluación cuando tenga resultados. Mantener los enlaces internos del landing donde todavía aportan contexto.
- Conservar marca, temas y tokens existentes. El estudio usa una composición orientada a operar; los artículos priorizan lectura. No trasladar animaciones de aparición del landing a cambios frecuentes del editor o tablas.
- Resolver rutas desconocidas con una página breve de «No encontrado», y ejemplos/artículos inexistentes con enlaces de recuperación.

## 10. Qué adaptar de `csharp-x86-compi`

La referencia revisada es el código local, especialmente `typescript/packages/web/src/App.tsx`, `components/Inspector.tsx`, `components/views/OptimizationView.tsx`, `lib/useProvenanceScroll.ts`, `lib/compiler-types.ts` y `backend/README.md`. No se ejecutó su aplicación durante esta revisión.

| Idea observada | Decisión para Cauce | Implementación propuesta |
|---|---|---|
| Resaltado bidireccional fuente ↔ ensamblador mediante mapa de origen. | Adaptar a fuente ↔ AST/FLOW/IR y, después, Python. | C1 conserva `span`; IR conserva `origin`; el backend debe emitir un mapa adicional para Python. Selección y navegación también accesibles por teclado, no solo hover. |
| Diff alineado antes/después y contadores de optimización. | Adaptar a IR y reporte por pase. | Comparar nodos por identidad/origen y expresiones; exponer transformaciones desde `passes.py`. Contar nodos no equivale a medir velocidad. |
| Inspector por pestañas y consola con estados por fase. | Adaptar a vistas del estudio y diagnósticos persistentes. | Contratos tipados, disponibilidad por fase y una selección compartida con el editor. |
| Ejecución explícita separada de recompilación al editar. | Adoptar. | Worker para análisis; servicio para ejecución; invalidación por revisión, pases y datasets. |
| Simulador de registros, pila e instrucciones. | No trasladar ese modelo a ETL. | Un posible inspector futuro muestra tablas por nodo materializado. Polars es lazy: seleccionar un nodo no debe fingir una ejecución secuencial ni mostrar filas sintéticas. |
| Puente Node que llama al compilador C++. | Usar una conexión propia más directa. | Servicio Python que importa `etl_dsl`, sin un proceso Node intermedio; Pyodide continúa compilando localmente. |
| Pruebas de navegador para compilación y optimización. | Adaptar los recorridos, sin copiar expectativas del lenguaje C#. | Verificar ejemplos ETL, diagnósticos, IR, revisión de resultados y ejecución Polars real. |

## 11. Evaluación de una interfaz por bloques tipo Scratch

### 11.1. Encaje con este lenguaje

**Sí merece evaluarse:** el usuario ya piensa en fuentes, transformaciones y destinos. Un bloque «Filtrar filas» con una condición visible puede facilitar el primer pipeline y evitar errores de llaves o conexiones. Esto es una hipótesis de usabilidad que debe probarse, no una ventaja medida todavía.

**Recomendación:** comenzar por un grafo de flujo de solo lectura en el estudio. Evaluar después un constructor de nodos con puertos y formularios, integrado como otra vista del mismo documento. No comprometer todavía un editor Scratch completo.

| Alternativa | Encaje | Coste y límite | Decisión |
|---|---|---|---|
| Bloques apilados como Scratch | Bueno para cadenas lineales y expresiones anidadas. | JOIN, ramas compartidas, varios destinos y `USE` necesitan conexiones adicionales; una pila deja de representar el programa completo. | No elegir como estructura principal. |
| Nodos conectados por puertos | Representa directamente el DAG de `FLOW`. | Exige resolver disposición, conexiones, formularios y navegación por teclado. | Mejor candidata para una prueba posterior. |
| Código acompañado de flujo de solo lectura | Usa el compilador actual y conserva toda la expresividad. | No elimina la escritura de sintaxis. | Primera entrega recomendada. |
| Formularios que añaden un paso a una cadena | Acceso inicial más sencillo y alcance acotado. | Solo cubre un subconjunto; debe permitir continuar en código. | Posible prototipo inicial del constructor. |

### 11.2. Cómo se integraría si se decide implementarlo

1. **Un solo documento:** el `.etl` es el formato persistido. Texto y vista visual son proyecciones de la misma revisión; ningún motor JavaScript ejecuta una semántica alternativa.
2. **Modelo visual desde el AST original:** cada declaración tiene nodo y cada conexión `FLOW` tiene arista. La IR optimizada se mantiene como resultado de análisis, porque puede fusionar o eliminar pasos que el usuario escribió.
3. **Edición mediante comandos:** añadir paso, modificar propiedad, conectar puerto o renombrar. Los comandos producen cambios transaccionales de texto y pasan por el parser/validador antes de confirmarse, con deshacer/rehacer común.
4. **Alcance inicial acotado:** una fuente CSV con esquema, `FILTER`, `SELECT`, `DERIVE`, `AGGREGATE` y un destino CSV/Parquet. Etiquetas en español; el código generado conserva las palabras clave del DSL.
5. **Expresiones:** comenzar con editor de expresión CodeMirror dentro del formulario; un sistema de bloques para expresiones es otro proyecto y queda fuera del primer prototipo.
6. **Cobertura parcial explícita:** operaciones o expresiones no editables se muestran como nodos de código y se preservan. JOIN y `USE` pueden visualizarse antes de admitir edición mediante formularios.
7. **Comentarios y formato:** preferir cambios locales por intervalos para conservar lo que no se edita. Un serializador completo AST → DSL necesitaría reglas de impresión y pruebas de ida/vuelta; el AST actual no conserva comentarios. No regenerar todo el archivo silenciosamente.
8. **Texto inválido:** mantener el último grafo válido marcado como desactualizado y bloquear sus mutaciones hasta recuperar una revisión válida. Nunca reemplazar el texto defectuoso por una versión vieja del grafo.
9. **Conexiones verificadas:** impedir ciclos y puertos ocupados de forma inmediata como ayuda, y confirmar siempre con el compilador Python. Las restricciones visuales no sustituyen `validation.py`.
10. **Accesibilidad:** añadir operaciones equivalentes a arrastrar mediante botones, lista de pasos y formularios navegables por teclado; en móvil, priorizar esa lista.

### 11.3. Cómo decidir si vale la pena

Antes de desarrollarlo completo, probar un prototipo con tareas de filtrar ventas, calcular una columna y agrupar totales. Comparar código con el constructor: finalización sin ayuda, tiempo, errores y comprensión del resultado. Incluir una tarea con ramificación para comprobar el límite de las cadenas lineales.

**Condición para avanzar:** el prototipo permite completar las tareas, conservar programas fuera del subconjunto y volver a código sin perder contenido. Si obliga a limitar el lenguaje o a mantener dos programas divergentes, conservar el flujo como visualización y posponer la edición.

**Estado de esta propuesta:** evaluada conceptualmente y registrada; no autorizada como trabajo inmediato por este plan. Las primeras páginas no dependen de ella.

## 12. Secuencia concreta para construir las páginas

| Paso | Alcance web | Dependencia | Resultado revisable |
|---|---|---|---|
| A | Enrutamiento, navegación y `/estudio` reutilizando CodeMirror y salidas textuales. | Código actual. | El landing abre un espacio de trabajo completo con borradores. |
| B | `/ejemplos` y `/docs`, detalles y acciones hacia el estudio. | Manifiestos y contenido existente. | Recorrido problema → explicación → programa editable. |
| C | API C1, estados por fase, AST expandible, FLOW de lectura y comparación de IR. | C1; C2–C4 se incorporan progresivamente. | Recorrido código ↔ fases con datos reales y posiciones. |
| D | Servicio de ejecución, bindings de ejemplos y vista Resultados. | W3 y runtime actual. | Recorrido código → ejecución → tabla → archivo. |
| E | `/evaluacion`, revisión de documentación y pruebas de navegador. | C5 para publicar métricas. | Evidencia reproducible y recorrido final comprobado. |
| F | Prototipo de constructor visual, solo si se decide avanzar tras evaluarlo. | Documento compartido, FLOW y pruebas de ida/vuelta. | Experimento separado que no retrasa el entorno funcional. |

Este orden permite construir las páginas del compilador actual desde el paso A. El trabajo semántico P0 continúa siendo prioritario para la entrega académica, pero no es condición para ofrecer una interfaz útil sobre las funciones que ya existen.
