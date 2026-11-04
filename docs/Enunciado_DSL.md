# CS3402 Compiladores 2026-2 — Proyecto 2

> Extracto de `Proyecto2_Enunciado-Compis.pdf`: solo las **Indicaciones generales** y el **Tipo 4 (DSL)**.

---

## Indicaciones generales

- Los estudiantes deberán trabajar en grupos y desarrollar uno de los proyectos propuestos en el curso.
- Cada proyecto deberá ser implementado de manera funcional, evidenciando la correcta aplicación de los conceptos de compiladores y lenguajes de programación desarrollados durante el curso.
- El desarrollo deberá incluir documentación técnica clara y estructurada, describiendo la arquitectura del sistema, las decisiones de diseño, las tecnologías utilizadas y los principales componentes implementados.
- Cada grupo deberá realizar una exposición técnica del proyecto, demostrando el funcionamiento del sistema y explicando adecuadamente los componentes desarrollados, las decisiones de implementación y los resultados obtenidos.
- Se recomienda el uso de herramientas modernas y buenas prácticas de ingeniería de software para la organización, implementación y documentación del proyecto.
- Todos los integrantes del equipo deberán participar activamente en el desarrollo del proyecto, demostrando contribuciones reales, verificables y consistentes con el trabajo presentado.
- Todos los integrantes del grupo deberán demostrar capacidad de análisis, investigación, implementación y comprensión profunda de los conceptos de compiladores y lenguajes de programación involucrados en el proyecto.
- El uso de herramientas de inteligencia artificial estará permitido únicamente como apoyo complementario durante el desarrollo del proyecto. Sin embargo, el trabajo deberá reflejar comprensión técnica real por parte de todos los miembros del grupo. En caso de evidenciarse dependencia excesiva de herramientas de IA, incapacidad para explicar el funcionamiento del código presentado o desconocimiento de los componentes implementados por parte de uno o más integrantes, **el proyecto será calificado con cero (0)**.
- En caso de detectarse que uno o más integrantes no han participado de manera efectiva en el desarrollo del trabajo, **el proyecto será calificado con cero (0)**.
- Cada tipo de proyecto cuenta con una actividad bonificadora, correspondiente a su máximo logro, cuyos requisitos se describen en la sección Bonificación de cada proyecto. Los grupos que la completen satisfactoriamente podrán obtener **hasta 3 puntos adicionales en el Examen final** del curso. Esta actividad es opcional y no forma parte de los objetivos mínimos del proyecto.
- Todo grupo que aspire a obtener la bonificación deberá asistir obligatoriamente a **tres reuniones de seguimiento** programadas: dos con Leonardo (ACL del curso) y una con el profesor. En cada reunión, el grupo deberá presentar los avances de su proyecto, con el objetivo de recibir orientación y retroalimentación constructiva durante el proceso. Los grupos que no cumplan con las tres reuniones no podrán acceder a la bonificación, aun cuando hayan alcanzado el máximo logro del proyecto.

---

## Tipo 4: Diseño e implementación de un lenguaje de dominio específico (DSL)

El objetivo del presente proyecto es diseñar e implementar un lenguaje de dominio específico (Domain-Specific Language, DSL) orientado a resolver un problema concreto de un área de aplicación, junto con su compilador completo. A diferencia de un lenguaje de propósito general, un DSL ofrece abstracciones, notación y verificaciones adaptadas al dominio, lo que permite expresar soluciones de forma más concisa, segura y cercana al lenguaje de los expertos del área. A lo largo del proyecto, los estudiantes analizarán las necesidades de un dominio, diseñarán la sintaxis y la semántica del lenguaje, implementarán todas las fases del proceso de compilación, evaluarán experimentalmente la utilidad del DSL frente a soluciones basadas en lenguajes de propósito general y documentarán su trabajo en un reporte con formato de artículo científico.

Algunos dominios posibles son: procesamiento de datos, gráficos y visualización, simulación científica, robótica, finanzas, redes, videojuegos, hardware, música, consultas sobre bases de datos o aprendizaje automático, entre otros.

### Objetivos

Los estudiantes deberán:

1. Seleccionar un dominio de aplicación y justificar la necesidad del DSL, identificando a sus usuarios objetivo, los problemas que resuelve y las limitaciones de las soluciones existentes basadas en lenguajes de propósito general o bibliotecas. **El dominio deberá ser aprobado por el docente antes del inicio del desarrollo.**
2. Analizar DSLs existentes en el dominio elegido o en dominios afines, identificando sus decisiones de diseño, fortalezas y debilidades.
3. Diseñar la sintaxis concreta y abstracta del lenguaje, definiendo formalmente su gramática (por ejemplo, en notación BNF o EBNF).
4. Definir la semántica del lenguaje, especificando con precisión el significado de cada construcción y su comportamiento en tiempo de ejecución.
5. Diseñar un sistema de tipos y de verificaciones semánticas propias del dominio, capaz de detectar en tiempo de compilación errores que un lenguaje de propósito general no detectaría (por ejemplo, incompatibilidad de unidades de medida, dimensiones de matrices, rangos de valores válidos o restricciones propias del dominio).
6. Implementar un compilador completo que incluya las fases de análisis léxico, sintáctico y semántico, con manejo de errores y mensajes de diagnóstico claros, expresados en términos del dominio.
7. Diseñar una representación intermedia sobre la cual se apliquen los análisis y las transformaciones del compilador.
8. Implementar **al menos dos optimizaciones específicas del dominio**, que aprovechen el conocimiento de la semántica del DSL (por ejemplo, fusión de operaciones, eliminación de cálculos redundantes, reordenamiento de consultas o simplificación de expresiones propias del dominio).
9. Generar código para al menos uno de los siguientes destinos: ensamblador x86, LLVM IR, WebAssembly o un lenguaje de propósito general (por ejemplo, C, Python o JavaScript) mediante transpilación. En este último caso, el código generado deberá ser legible, correcto y eficiente.
10. Elaborar la documentación del lenguaje, incluyendo una especificación de referencia, una guía de uso y un conjunto de programas de ejemplo representativos del dominio.
11. Desarrollar un conjunto de pruebas que verifique la corrección del compilador, incluyendo programas válidos, programas con errores y casos límite.
12. Garantizar la reproducibilidad del trabajo mediante un repositorio público con el código del compilador, los programas de ejemplo, los benchmarks y las instrucciones para replicar los experimentos.
13. Redactar un reporte final con formato de artículo científico.
14. Presentar y defender el proyecto mediante una exposición técnica con formato de conferencia académica.

### Evaluación experimental

La evaluación deberá considerar, como mínimo, los siguientes aspectos:

- **Expresividad:** comparación entre programas escritos en el DSL y programas equivalentes en un lenguaje de propósito general, considerando métricas como líneas de código, número de construcciones utilizadas y legibilidad.
- **Rendimiento:** tiempo de ejecución del código generado por el DSL frente a implementaciones equivalentes escritas manualmente en un lenguaje de propósito general o con bibliotecas de uso extendido en el dominio.
- **Impacto de las optimizaciones:** mejora obtenida por cada optimización específica del dominio, midiendo el rendimiento con y sin cada una de ellas.
- **Detección de errores:** un conjunto de programas con errores propios del dominio, indicando cuáles son detectados en tiempo de compilación por el DSL y cuáles pasarían inadvertidos en un lenguaje de propósito general.
- **Usabilidad (opcional):** evaluación con usuarios del dominio, por ejemplo, mediante tareas guiadas y encuestas, que permita valorar la facilidad de aprendizaje y uso del lenguaje.

Las mediciones deberán garantizar su validez estadística mediante múltiples ejecuciones, medidas de dispersión y la descripción detallada del entorno experimental.

### Entregables

Al finalizar el proyecto, cada grupo deberá presentar los siguientes entregables en una única entrega:

- **Código fuente:** repositorio público con el código del compilador, el conjunto de pruebas, los programas de ejemplo, los benchmarks y las instrucciones para compilar el compilador, ejecutarlo y replicar los experimentos.
- **Documentación del lenguaje:** especificación de referencia, guía de uso y programas de ejemplo representativos del dominio.
- **Reporte técnico:** documento en LaTeX con formato de artículo científico, utilizando la plantilla de una conferencia del área (por ejemplo, la plantilla acmart en formato SIGPLAN, o la plantilla de conferencias IEEE). Tendrá una extensión de **entre 6 y 10 páginas**, sin contar referencias ni apéndices, y deberá incluir, como mínimo, las siguientes secciones:
  - **Resumen (Abstract):** síntesis del dominio, el problema abordado, el diseño del lenguaje y los principales resultados.
  - **Introducción:** contexto del dominio, motivación, limitaciones de las soluciones existentes y contribuciones del trabajo.
  - **Trabajos relacionados:** revisión de DSLs, bibliotecas y herramientas existentes en el dominio, y posicionamiento del lenguaje propuesto frente a ellos.
  - **Diseño del lenguaje:** principios de diseño, sintaxis (con la gramática formal), semántica, sistema de tipos y verificaciones propias del dominio, ilustrados con ejemplos.
  - **Implementación:** arquitectura del compilador, representación intermedia, optimizaciones específicas del dominio y generación de código, incluyendo diagramas de las fases de compilación.
  - **Evaluación:** metodología experimental, entorno de ejecución y resultados de cada uno de los aspectos de la evaluación experimental, presentados mediante tablas y gráficos.
  - **Discusión:** interpretación de los resultados, limitaciones del lenguaje y de su implementación, y amenazas a la validez del estudio.
  - **Conclusiones y trabajo futuro.**
  - **Referencias:** bibliografía en un formato estándar (ACM o IEEE), basada en fuentes académicas.
  - **Apéndices:** gramática completa del lenguaje, programas de ejemplo representativos y enlace al repositorio público del proyecto.

  Toda idea, dato, figura o fragmento de código de terceros deberá estar debidamente citado. El uso de herramientas de inteligencia artificial deberá declararse explícitamente en el reporte, indicando en qué partes del trabajo fueron utilizadas.
- **Exposición final:** presentación técnica con formato de conferencia académica, que incluya una demostración del DSL resolviendo problemas representativos del dominio.

### Bonificación

El máximo logro del proyecto consistirá en la implementación de un entorno de desarrollo funcional para el DSL que permita demostrar, de manera integrada, las distintas fases del proceso de compilación y la utilidad del lenguaje en su dominio. Los grupos que logren desarrollar dicho entorno podrán obtener hasta 3 puntos adicionales en el Examen final del curso. El entorno deberá incluir, como mínimo, los siguientes componentes:

- Editor de código para el DSL, con resaltado de sintaxis y de errores léxicos, sintácticos y semánticos.
- Visualización del AST (Abstract Syntax Tree).
- Visualización de la representación intermedia antes y después de aplicar las optimizaciones.
- Visualización del código generado para el destino elegido.
- Ejecución del programa compilado.
- Visualización de resultados de ejecución adaptada al dominio (por ejemplo, gráficos, tablas, simulaciones o animaciones).

Como alternativa al entorno independiente, se aceptará una extensión para un editor de uso extendido (por ejemplo, Visual Studio Code) basada en el Language Server Protocol (LSP), que ofrezca diagnóstico de errores, autocompletado, navegación entre definiciones y ejecución integrada del programa, siempre que incluya también la visualización del AST y de la representación intermedia.
