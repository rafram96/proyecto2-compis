# Auditoría y mejoras de Stream Studio

Fecha: 12 de noviembre de 2026 (America/Lima). Rama: `feat/studio-ux-audit`.

## Alcance y método

Revisión del sitio, Studio, contratos del compilador, documentación publicada y referencias locales `csharp-x86-compi` y `ultimate-parser-app`. Se conserva el núcleo `etl_dsl`, CodeMirror, los borradores y la distinción entre compilación local y ejecución en el servicio. Los cambios previos del usuario en `.gitignore` y `uv.lock` no forman parte de esta intervención.

La inspección inicial utiliza Chromium a 1440 × 1000 y 390 × 844, código fuente y las 64 pruebas Node existentes. Las capturas de trabajo quedan en `.playwright-cli/`, ignorado por Git. Las conclusiones de accesibilidad son comprobaciones acotadas, no una certificación WCAG ni un estudio con usuarios.

## Hallazgos y solución

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

Puntos que se conservan: salida del compilador real, artefactos parciales, asociación exacta a revisión/pases, compilación en worker, importación UTF-8 y límites de almacenamiento, CodeMirror estable al cambiar vistas y alternativas con teclado.

## Decisiones técnicas

- La marca de la web pasa a **Stream**. La ruta canónica será `/studio`; `/estudio` se conserva como entrada compatible. Se mantienen las claves `cauce-*` de almacenamiento para recuperar los documentos y preferencias existentes.
- **D3 hierarchy** calcula la disposición del árbol; React conserva los controles HTML y sus estados. Se evita incorporar un motor completo de edición de grafos para vistas de lectura. [Documentación oficial de D3](https://d3js.org/d3-hierarchy/tree).
- **jsdiff** compara líneas sin atribuir por su cuenta los cambios a pases. La identidad de nodos sigue basándose en `origin`, como en el contrato existente. [Repositorio y documentación oficial](https://github.com/kpdecker/jsdiff).
- Se evaluó **Blockly**: permite definir bloques y generar código, pero traducir todo este DSL con `USE`, puertos, JOIN y expresiones requiere un proyecto adicional. Se implementará primero un constructor de pipelines lineales con formularios y reordenación accesible. No se promete conversión bidireccional de cualquier programa. [Documentación oficial de Blockly](https://docs.blockly.com/guides/get-started/what-is-blockly/).
- C# aporta el patrón de resaltar procedencia al pasar el cursor; Ultimate Parser aporta la representación de jerarquía como nodos y conexiones. No se copia su implementación ni se infiere semántica nueva a partir del dibujo.

## Validación y entrega

Registro de pruebas, resultados, limitaciones y recorrido de revisión: se completa al cerrar la implementación.
