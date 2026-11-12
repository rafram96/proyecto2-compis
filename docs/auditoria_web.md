# Auditoría y mejoras de Stream Studio

Fecha: 12 de noviembre de 2026 (America/Lima). Rama: `feat/studio-ux-audit`.

## Alcance y método

Revisión del sitio, Studio, contratos del compilador, documentación publicada y referencias locales `csharp-x86-compi` y `ultimate-parser-app`. Se conserva el núcleo `etl_dsl`, CodeMirror, los borradores y la distinción entre compilación local y ejecución en el servicio. Los cambios previos del usuario en `.gitignore` y `uv.lock` no forman parte de esta intervención.

La inspección inicial utiliza Chromium a 1440 × 1000 y 390 × 844, código fuente y las 64 pruebas Node existentes. Las capturas de trabajo y registros quedan en `web/.playwright-cli/`, ignorado por Git; tres capturas de entrega están versionadas junto a este informe. Las conclusiones de accesibilidad son comprobaciones acotadas, no una certificación WCAG ni un estudio con usuarios.

## Hallazgos y solución aplicada

| Prioridad | Hallazgo observado | Efecto | Solución |
| --- | --- | --- | --- |
| P1 | Parse tree solo como texto indentado; AST requiere abrir propiedades e índices | Cuesta reconocer jerarquía y distinguir declaraciones de expresiones | Árboles gráficos con nodos, conexiones, expansión progresiva y selector de pipeline; conservar texto y propiedades |
| P1 | IR muestra bloques JSON sin resaltar líneas | Hay que comparar cada propiedad manualmente | Diff alineado, retiradas en rojo y añadidas en verde, con símbolos y recuentos |
| P1 | FAQ afirma que Studio nunca envía código aunque Run sí lo hace | Explicación incorrecta de la frontera de ejecución | Diferenciar Compile local, Run remoto y Python descargado |
| P2 | Marca y controles poco alineados con el vocabulario de herramientas de desarrollo | Inconsistencia con la expectativa solicitada | Stream, Studio, Compile y términos técnicos habituales con explicaciones en español |
| P2 | «Lista accesible» describe una implementación | No anticipa qué encontrará quien pulsa | «Lista de pasos», equivalente textual útil también con teclado |
| P2 | Tokens como columnas de texto, sin filtro ni selección | Difícil encontrar un lexema y ubicarlo en el código | Tabla con búsqueda, categoría, páginas y enlace al rango original |
| P2 | Seleccionar fuente exige clic y mueve el foco | Interrumpe comparar el código con el inspector | Preview por hover/foco, manteniendo el clic para seleccionar |
| P2 | Errores HTTP 5xx se explican como una solicitud inválida | Se atribuye al usuario una desconexión del servicio | Mensaje de servicio no disponible con recuperación y compilación local disponible |
| P2 | Empezar exige escribir sintaxis del DSL | Barrera para la audiencia que no conoce Python/Polars | Constructor visual acotado, con código visible y apertura como copia |
| P1 | Contraste insuficiente en superficies azules, marcos atenuados y estados hover | Texto difícil de leer; WCAG 1.4.3 | Token `--surface-accent`, estados seleccionados consistentes y marcos opacos |
| P1 | Enlaces de documentación, benchmarks y créditos distinguidos solo por color | Difíciles de reconocer, especialmente en oscuro; WCAG 1.4.1 | Subrayados persistentes en enlaces de lectura |
| P1 | Fragmentos desplazables sin acceso con teclado | No se puede recorrer todo el código en móvil; WCAG 2.1.1 | `tabIndex`, nombres accesibles y foco visible en diagnósticos y comandos |
| P1 | ARIA de selección en una maqueta estática y etiquetas sobre spans del diff | Semántica inválida para tecnologías de asistencia | Estado visual mediante `data-selected`; texto accesible para líneas añadidas/retiradas |
| P2 | Reducción de movimiento mediante una regla global de 0.01 ms | No define una alternativa de lectura; mantiene desplazamientos ajenos a la preferencia | Contenido inmediato, indicadores estáticos, transiciones explícitas y fases discretas en el héroe |
| P2 | CSS de fuentes incluye subconjuntos no utilizados por la interfaz | Transferencia innecesaria | Fuentes Latin autoalojadas; CSS comprimido de 43.73 KB a aproximadamente 16.4 KB |

Los 15 hallazgos de la tabla quedan atendidos: 7 P1 y 8 P2; no se encontró un bloqueo P0. La revisión visual de la implementación detectó además que los controles nuevos ocultaban casi todo el grafo móvil: se compactó el zoom y el inspector móvil pasó a crecer con el contenido.

Puntos que se conservan: salida del compilador real, artefactos parciales, asociación exacta a revisión/pases, compilación en worker, importación UTF-8 y límites de almacenamiento, CodeMirror estable al cambiar vistas y alternativas con teclado.

## Decisiones técnicas

- La marca de la web pasa a **Stream**. La ruta canónica es `/studio`; `/estudio` se conserva como entrada compatible. Se mantienen las claves `cauce-*` de almacenamiento para recuperar los documentos y preferencias existentes.
- **D3 hierarchy** calcula la disposición del árbol; React conserva los controles HTML y sus estados. Se evita incorporar un motor completo de edición de grafos para vistas de lectura. [Documentación oficial de D3](https://d3js.org/d3-hierarchy/tree).
- **jsdiff** compara líneas sin atribuir por su cuenta los cambios a pases. La identidad de nodos sigue basándose en `origin`, como en el contrato existente. [Repositorio y documentación oficial](https://github.com/kpdecker/jsdiff).
- Se evaluó **Blockly**: permite definir bloques y generar código, pero traducir todo este DSL con `USE`, puertos, JOIN y expresiones requiere un proyecto adicional. Se implementó un constructor de pipelines lineales con formularios y reordenación accesible. No se promete conversión bidireccional de cualquier programa. [Documentación oficial de Blockly](https://docs.blockly.com/guides/get-started/what-is-blockly/).
- C# aporta el patrón de resaltar procedencia al pasar el cursor; Ultimate Parser aporta la representación de jerarquía como nodos y conexiones. No se copia su implementación ni se infiere semántica nueva a partir del dibujo.

## Localización de los cambios

| Área | Archivos principales |
| --- | --- |
| Marca, entrada compatible y navegación | `web/src/App.tsx`, `components/Nav.tsx`, `workspace/view.ts`, `web/index.html`, manifest y recurso social |
| Parse tree y AST | `components/inspectors/tree.ts`, `TreeGraph.tsx`, `GraphViewport.tsx`, `AstInspector.tsx`, `ParseTreeInspector.tsx` |
| Flow y tokens | `components/inspectors/FlowInspector.tsx`, `TokensInspector.tsx` |
| Diff y procedencia | `components/inspectors/IRInspector.tsx`, `IRDiff.tsx`, `diff.ts`, `SourceButton.tsx`, `editor/preview.ts`, `editor/Editor.tsx` |
| Blocks | `web/src/blocks/model.ts`, `BlockBuilder.tsx`, `pages/StudioPage.tsx`, `styles/blocks.css` |
| Accesibilidad y lectura | `components/Errors.tsx`, `Language.tsx`, `Hero.tsx`, `pages/EvaluationPage.tsx`, `index.css`, `styles/brand.css` |
| Comunicación del servicio | `components/Faq.tsx`, `execution/client.ts` |
| Guías y regresión | `docs/guia_estudio.md`, `docs/tutorial.md`, `web/tests/visual-models.test.mjs`, `web/tests/browser/ux.js`, `accessibility.js` |

Las rutas abreviadas de esta tabla son relativas a `web/src/`. El plan aplicado fue corregir navegación y comunicación, construir los inspectores, añadir Blocks con un alcance verificable y cerrar con accesibilidad y recorridos reales.

## Resultado de la revisión técnica

Valoración orientativa sobre las superficies comprobadas; no es una certificación WCAG.

| Dimensión | Valoración | Evidencia y límite |
| --- | --- | --- |
| Accesibilidad | 3/4 | Teclado, foco, nombres y contraste comprobados; sin evaluación con usuarios de lector de pantalla |
| Rendimiento | 3/4 | Inspectores y Blocks en chunks diferidos; tablas paginadas, límites de grafo/diff y fuentes acotadas; Pyodide sigue requiriendo una primera descarga |
| Temas | 4/4 | Tokens compartidos, contraste corregido y recorrido claro/oscuro |
| Responsive | 3/4 | 390 × 844 y 1440 × 1000, sin desbordamiento del documento; tamaños adicionales en el recorrido del divisor. Sin dispositivo táctil físico |
| Integridad | 4/4 | Artefactos del núcleo, procedencia por revisión, copias independientes y límites explícitos; detector mecánico de inspectores/Blocks sin hallazgos |
| **Total** | **17/20 · bueno** | Las mejoras posteriores deben partir de pruebas con usuarios y dispositivos reales |

## Validación

| Comprobación | Resultado |
| --- | --- |
| `.venv/bin/python -m unittest discover -s tests -q` | **180/180** |
| `npm --prefix web test` | **69/69**; incluye siete operaciones generadas y aceptadas por el compilador real, escapes, referencias tras reordenar, diff y árboles reales |
| `npm --prefix web run build` | TypeScript y Vite correctos |
| Generadores `gen_content.py`, `gen_compiled.py`, `gen_evaluation.py`, `gen_http.py` con `--check` | Correctos |
| Suite completa `verify_browser.py` contra Vite | Ocho recorridos correctos: paridad de 32 salidas CPython/Pyodide, workspace, contenido, inspectores, evaluación, disposición, tutorial y sugerencias |
| `verify_browser.py --ux-only` contra el build servido por `vite preview` | Alias antiguo, grafos, hover sin recompilar, tokens, diff/O0, bloques, preservación del borrador, ejecución real y descarga correctos; sin errores de página |
| `verify_browser.py --a11y-only`, axe-core 4.14.0 | **24 combinaciones, 0 infracciones detectadas** en las reglas ejecutadas |
| Descargas de las suites existentes | `.etl`, Python y dos CSV del tutorial comparados byte a byte con el núcleo/runtime; ocho archivos de evaluación comprobados por SHA-256 |

El pipeline creado desde Blocks filtra importes positivos, agrupa por cliente, suma y ordena. La API real lo ejecutó con `join-orders@1` y se descargó este CSV:

```csv
cliente,total
2,70
1,10
```

La comprobación de accesibilidad cubre landing, tutorial, guía de Studio, catálogo, detalle de ventas, benchmarks y las vistas AST/Tokens/IR/Flow/Parse tree/Blocks. Cada una se revisa en escritorio claro y móvil oscuro. Son reglas automáticas WCAG 2 A/AA y 2.1 AA; no cubren toda la norma ni sustituyen una revisión con tecnologías de asistencia. Los colores se inspeccionan con el tema establecido antes de navegar, para no medir estados intermedios de una transición.

### Repetir los recorridos

Con el servicio Python local en el puerto 8000 y Vite o preview iniciado:

```sh
# Suite completa de desarrollo
.venv/bin/python web/scripts/verify_browser.py --url http://127.0.0.1:5173/

# Funcionalidad nueva contra el build
.venv/bin/python web/scripts/verify_browser.py --ux-only --url http://127.0.0.1:4173/

# Auditor opcional, aislado de las dependencias del producto
npm install --prefix web/.playwright-cli/audit-tools --no-save axe-core@4.14.0
.venv/bin/python web/scripts/verify_browser.py --a11y-only --url http://127.0.0.1:4173/
```

El comando de build es `npm --prefix web run build`; para servirlo, `npm --prefix web run preview -- --host 127.0.0.1 --port 4173`. Los comandos del servicio están en `docs/servicio_ejecucion.md`.

## Revisar la entrega

1. Abre `/studio`, pulsa Compile y visita AST: cambia de pipeline, abre una rama y prueba hover/foco/clic sobre un STEP. Texto y JSON siguen disponibles.
2. En IR, activa «Solo nodos con cambios». Desplaza la comparación hasta la expresión modificada; con O0 no aparecen líneas añadidas ni retiradas.
3. En Tokens, busca `pagados`, filtra por tipo y selecciona una ubicación. En Flow, alterna grafo/lista y sigue una conexión al código.
4. En Blocks, añade un resumen y ordenación. Reordena un bloque con referencias a columnas posteriores para ver la validación; corrige el orden y abre como copia. Tu documento anterior queda en Borradores anteriores.
5. Comprueba móvil, ambos temas y la opción del sistema para reducir movimiento.

Capturas versionadas del build: [AST](auditoria_web/studio-ast.png), [diff de IR](auditoria_web/ir-diff.png), [Blocks](auditoria_web/blocks.png). El diff puede necesitar desplazamiento interno para llegar a las líneas modificadas, como en la propia aplicación.

## Límites y evolución propuesta

- Blocks cubre pipelines lineales CSV, 7 operaciones, hasta 24 bloques y 32 columnas de entrada. Los cálculos guiados son aritmética simple y los filtros de orden son numéricos. JOIN, USE, ramificaciones, expresiones libres e importación de un programa arbitrario se resuelven en Code. Ampliarlo a Blockly y hacer una conversión bidireccional requiere especificar cómo conservar comentarios, orden, expresiones y puertos antes de implementarla.
- El borrador visual dura esta visita. Abrir como copia o descargar conserva el programa; recargar no recupera la edición visual. El documento Code mantiene su persistencia anterior.
- La proyección del AST admite hasta 4000 nodos y 70 niveles; el parse tree procesa hasta 4000 líneas de `pretty()`. Ambos dibujos admiten 350 nodos visibles a la vez, indican los límites y conservan el texto/JSON completo. El parse tree se dibuja a partir del `pretty()` de Lark y no inventa posiciones; la selección exacta está en AST y Tokens.
- El diff compara propiedades estructurales por líneas, no ejecuta los planes ni atribuye un cambio a un pase sin traza. Una fusión comparte el nodo final por `origin`. Si el cálculo supera su presupuesto, se muestran ambos bloques como reemplazo; enteros fuera del rango seguro se consultan en el texto exacto.
- Se verificó Chromium con viewports emulados, mouse y teclado. Safari, Firefox, dispositivos táctiles físicos y lectores de pantalla requieren una pasada específica. El paso siguiente recomendado es observar a alguien que no conozca Polars creando y ejecutando un pipeline desde Blocks.

## Historial

- `d45482b`: marca Stream Studio, navegación compatible y explicación de ejecución.
- `f79c6da`: grafos, preview de fuente, diff, tokens y constructor por bloques.
- Cierre: correcciones de accesibilidad, recorridos reproducibles, documentación y capturas en esta misma rama.
