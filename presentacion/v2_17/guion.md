# CaPybara | De una pregunta de negocio a un pipeline confiable

17 diapositivas. Notas para exponer y fuentes del contenido.

El tiempo de la apertura es ilustrativo. Las afirmaciones de facilidad frente a SQL se presentan como intención de diseño; rendimiento y tokens se acotan a las tareas medidas.

## 01. Son las 8:40. El reporte se necesita a las 9.

**Idea:** Solo queríamos saber cuánto vendió cada cliente.

8 min revisando sintaxis.
7 min corrigiendo columnas.
5 min resolviendo nulos.
20 minutos antes de responder la pregunta.

**Pie de la diapositiva:** Escenario ilustrativo: no medimos tiempo de desarrollo ni ahorro de minutos en CaPybara.

**Para exponer:** Imaginemos a una analista que recibe un CSV y necesita un resumen de ventas para una reunión. El cálculo es pequeño, pero antes debe recordar una API, comprobar nombres y decidir qué hacer con los valores faltantes. La distribución de veinte minutos es ficticia y sirve para plantear la historia; no es un resultado del proyecto. Nuestro objetivo es reducir esa fricción sin renunciar a un motor eficiente.

**Transición:** Describir el proceso a un nivel más alto.

**Fuente:** Escenario narrativo explícitamente ilustrativo.

## 02. ETLCL: separar el proceso de la plataforma

**Idea:** Describir el proceso a un nivel más alto.

Popović et al. (2024) proponen ETLCL para organizar tareas y dependencias de procesos ETL.
La especificación se transforma a distintas plataformas.
Nos inspira a hacer explícito el proceso; CaPybara tipa y transforma las tablas.

**Pie de la diapositiva:** PeerJ Computer Science 10:e1835 · DOI 10.7717/peerj-cs.1835 · pp. 1–3 y 19–22.

**Para exponer:** El primer antecedente aborda la complejidad de mantener procesos ETL ligados a herramientas específicas. ETLCL describe tareas, dependencias, grupos y su ejecución, y genera artefactos para distintas plataformas. Su pequeña evaluación entrevista a cuatro profesionales; los tiempos de su tabla 5 son estimaciones de esos expertos, no una medición de CaPybara. La idea que tomamos es separar la intención del proceso de sus detalles tecnológicos; nuestro alcance añade esquemas tipados y transformaciones tabulares compiladas a Polars.

**Transición:** Que el flujo sea claro para quien lo lee y para quien lo genera.

**Fuente:** C:/Users/USER/Downloads/peerj-cs-1835.pdf · pp. 1–3, 19, 21–22 · https://doi.org/10.7717/peerj-cs.1835

## 03. Jayvee y Anka: una estructura explícita ayuda

**Idea:** Que el flujo sea claro para quien lo lee y para quien lo genera.

JAYVEE · Heltweg et al. (2025): 57 participantes; comprensión más correcta frente a Python/Pandas, sin diferencia significativa de tiempo.
ANKA · Al Mazrouei (2025): sintaxis restringida y documentación en el prompt; en tareas multi-step, 100 % frente a 60 % con Claude 3.5 Haiku.
Nuestra pregunta: ¿podemos sumar esa claridad a un motor rápido?

**Pie de la diapositiva:** Jayvee: arXiv:2505.16764v2, pp. 1, 12–13 · Anka: arXiv:2512.23214v1, pp. 1, 6–7. Son resultados de otros sistemas.

**Para exponer:** Jayvee compara la comprensión de la estructura de pipelines con Python y Pandas. En 57 participantes, la mediana de corrección fue 1,00 frente a 0,92; el estudio no encontró una diferencia significativa de tiempo. Anka explora otra audiencia: los modelos de lenguaje. Su preprint informa una ventaja de cuarenta puntos en tareas de varios pasos con Claude 3.5 Haiku, usando diez muestras por tarea; ese protocolo es diferente al nuestro. De Jayvee tomamos la estructura explícita del flujo; de Anka, la sintaxis consistente, la guía del lenguaje y el benchmark para LLMs.

**Transición:** Escribir la intención. Ejecutar con Polars.

**Fuente:** C:/Users/USER/Downloads/2505.16764v2.pdf · pp. 1, 12–13 · https://arxiv.org/abs/2505.16764; C:/Users/USER/Downloads/2512.23214v1.pdf · pp. 1, 6–7 · https://arxiv.org/abs/2512.23214

## 04. Ahí aparece CaPybara

**Idea:** Escribir la intención. Ejecutar con Polars.

Un DSL para extraer, transformar y guardar tablas.
Contratos explícitos de columnas, tipos y nulos.
Sintaxis lineal para lo simple y un grafo para componer.
Genera Python legible con la API diferida de Polars.

**Pie de la diapositiva:** DSL = lenguaje de dominio específico. ETL = extracción, transformación y carga.

**Para exponer:** CaPybara reúne estas ideas en un compilador de pipelines tabulares. El usuario describe qué quiere leer, limpiar, transformar y guardar; el compilador comprueba sus contratos y emite Python. Para los casos simples ofrecemos una cadena de pasos y para joins y composición, un grafo explícito. La ejecución se delega en Polars para aprovechar su motor columnar y su optimizador.

**Transición:** Leer → limpiar → filtrar → sumar → guardar.

**Fuente:** README.md; reporte/main_v2.tex, secciones de diseño e implementación.

## 05. Del CSV al resumen, en el orden en que lo piensas

**Idea:** Leer → limpiar → filtrar → sumar → guardar.

PIPELINE ventas {
  FROM CSV(file: "ventas.csv")
    AS TABLE[cliente: STRING, monto: DECIMAL?];
  FILL_NULL { monto = 0; }
  FILTER { WHERE monto > 0; }
  AGGREGATE {
    GROUP_BY cliente;
    SUM(monto) AS total;
  }
  TO PARQUET(file: "resumen.parquet");
}

**Pie de la diapositiva:** Entrada: Ana 120, Ana NULL, Luis 80, Ana 30 → salida: Ana 150, Luis 80. El ? admite nulos; las instrucciones terminan en ;.

**Para exponer:** Leemos el mismo archivo de ventas de la historia. El esquema hace explícitas las columnas; el signo de interrogación admite montos faltantes. Rellenamos los nulos con cero, filtramos los montos positivos y sumamos por cliente. El compilador y el runtime del proyecto verificaron que el ejemplo produce ciento cincuenta para Ana y ochenta para Luis.

**Transición:** El compilador entiende las tablas que están pasando por cada paso.

**Fuente:** presentacion/ventas.etl y presentacion/verificacion.json.

## 06. Un contrato antes de tocar los datos

**Idea:** El compilador entiende las tablas que están pasando por cada paso.

Texto → Lark → AST y validación → IR de grafo
→ tipos y nulabilidad → optimizaciones → Python + Polars.

WHERE mnto > 0;
→ E_COLUMN: columna inexistente.
Con esquema declarado, este error se detecta sin abrir el archivo.

**Pie de la diapositiva:** Tres pases del DSL: evaluación de constantes, fusión de filtros y eliminación de código muerto. El entorno web muestra las fases.

**Para exponer:** Lark reconoce la sintaxis; después construimos el AST y validamos la estructura. Una representación de grafo permite propagar esquemas, comprobar tipos y aplicar tres transformaciones antes de generar Python. Esa información explica por qué podemos rechazar una columna mal escrita sin leer los datos cuando existe un esquema declarado. Las restricciones que dependen del contenido real, como la presencia de un nulo, se verifican al ejecutar.

**Transición:** 508 tokens frente a 652 en Polars: 22 % menos.

**Fuente:** reporte/main_v2.tex, arquitectura del compilador y sistema de tipos.

## 07. Menos tokens; la intención sigue visible

**Idea:** 508 tokens frente a 652 en Polars: 22 % menos.

Cinco tareas equivalentes.
La reducción es frente a Polars.
No implica menos líneas: 78 frente a 61.
No prueba por sí sola usabilidad humana.

**Pie de la diapositiva:** Tokens léxicos del código, no tokens de un LLM. Fuente: bench/resultados/expresividad.csv.

**Para exponer:** Contamos el código de las mismas cinco tareas, sin comentarios ni líneas vacías. CaPybara acumula quinientos ocho tokens frente a seiscientos cincuenta y dos de Polars, un veintidós por ciento menos. Sin embargo, ocupa más líneas porque cada transformación se escribe explícitamente. La cifra expresa tamaño léxico; no equivale a haber medido facilidad de aprendizaje ni a reducir el costo de tokens de un modelo de lenguaje.

**Transición:** Cinco tareas, cuatro herramientas, cuatro escalas.

**Fuente:** reporte/generado_v2/figuras/expresividad.png; bench/resultados/expresividad.csv.

**Gráfico original:** `reporte/generado_v2/figuras/expresividad.png`

## 08. La misma historia, hasta 180 millones de filas

**Idea:** Cinco tareas, cuatro herramientas, cuatro escalas.

TPC-H adaptado: SF 1, 10, 20 y 30.
Un calentamiento y diez repeticiones.
Resultados verificados antes de medir.
Medianas y rango intercuartílico.

**Pie de la diapositiva:** SF 30: 180 millones de filas en lineitem. Excluye arranque y compilación; compilación aparte: mediana de 42 ms.

**Para exponer:** Para comprobar la promesa ejecutamos cinco tareas equivalentes con CaPybara, Polars manual, Pandas y DuckDB. Los datos se derivan de TPC-H y se omiten filtros de fecha que el DSL todavía no soporta; no es la certificación oficial de TPC-H. Usamos un calentamiento y diez repeticiones por configuración, verificando antes los resultados. Los paneles usan escala logarítmica y rangos propios: hay que comparar dentro de cada tarea. El tiempo de ejecución excluye arranque de Python y compilación.

**Transición:** Entre 0 % y 7 % de sobrecosto en cuatro de cinco tareas.

**Fuente:** reporte/generado_v2/figuras/escalabilidad.png; reporte/main_v2.tex, protocolo y entorno experimental.

**Gráfico original:** `reporte/generado_v2/figuras/escalabilidad.png`

## 09. En cuatro tareas, estamos muy cerca de Polars

**Idea:** Entre 0 % y 7 % de sobrecosto en cuatro de cinco tareas.

1× significa el tiempo de Polars.
Más de 1× significa más tiempo.
Pandas no completa devoluciones en el límite de memoria.
La excepción: limpieza de pedidos.

**Pie de la diapositiva:** Razones de medianas en SF 30. El eje de este gráfico es logarítmico.

**Para exponer:** Normalizamos todos los tiempos por Polars para ver la distancia al motor que usamos. En cuatro tareas, CaPybara queda entre cero y siete por ciento por encima en SF treinta. No afirmamos igualdad en todos los casos. Limpieza es la excepción clara y nos lleva a la siguiente pregunta: ¿por qué aparece esa diferencia?

**Transición:** Limpieza crece de 2,35× a 4,35× frente a Polars.

**Fuente:** reporte/generado_v2/figuras/panorama.png; reporte/generado_v2/tablas/rendimiento.tex.

**Gráfico original:** `reporte/generado_v2/figuras/panorama.png`

## 10. La excepción tiene una explicación: el orden

**Idea:** Limpieza crece de 2,35× a 4,35× frente a Polars.

CaPybara preserva el orden de los resultados.
DISTINCT y AGGREGATE pueden exigir más trabajo.
En tareas pequeñas también pesa un costo fijo.
Este mapa muestra dónde debemos optimizar.

**Pie de la diapositiva:** Cada celda divide mediana de CaPybara / mediana de Polars. 1× = paridad.

**Para exponer:** El mapa permite seguir el cociente de tiempos al aumentar la escala. En limpieza, preservar el orden tiene un costo que crece con los datos; el reporte también identifica ordenamientos posteriores que podrían hacer innecesario parte de ese trabajo. En tareas pequeñas, resolver esquemas añade alrededor de ochenta milisegundos de costo fijo. La conclusión no es ocultar la excepción, sino usarla para decidir qué pase conviene implementar.

**Transición:** El motor y la semántica cambian el costo de cada tarea.

**Fuente:** reporte/generado_v2/figuras/relativo.png; reporte/main_v2.tex, rendimiento y discusión.

**Gráfico original:** `reporte/generado_v2/figuras/relativo.png`

## 11. La velocidad también necesita caber en memoria

**Idea:** El motor y la semántica cambian el costo de cada tarea.

Resumen: CaPybara 1,6 GB; Pandas 25,5 GB.
Devoluciones: CaPybara 7,6 GB.
Pandas supera el límite de 31 GB en devoluciones.
CaPybara no usa menos memoria en todos los casos.

**Pie de la diapositiva:** Memoria pico por proceso en SF 30. No confundir memoria con tiempo de ejecución.

**Para exponer:** Una consulta rápida no basta si el proceso queda sin memoria. En resumen de precios, CaPybara consume uno coma seis gigabytes frente a veinticinco coma cinco de Pandas; en devoluciones, Pandas supera el límite del contenedor. Frente a Polars, los valores suelen ser parecidos, pero hay diferencias importantes: resumen usa más memoria con CaPybara y limpieza usa menos aunque tarde más. La comparación depende de la tarea y de la semántica que se conserva.

**Transición:** Los pases actuales del DSL aportan poco sobre Polars activo.

**Fuente:** reporte/generado_v2/figuras/memoria.png; reporte/generado_v2/tablas/memoria.tex.

**Gráfico original:** `reporte/generado_v2/figuras/memoria.png`

## 12. El motor ya optimiza; debemos aportar algo distinto

**Idea:** Los pases actuales del DSL aportan poco sobre Polars activo.

Polars transforma y optimiza el plan diferido.
Apagar su optimizador penaliza varias tareas.
El siguiente paso: aprovechar contratos, orden y salidas compartidas.

**Pie de la diapositiva:** O0 = Sin optimizaciones de Capybara (O0). No apaga el optimizador de Polars.

**Para exponer:** Este experimento separa los tres pases de CaPybara del optimizador propio de Polars. Con el motor activo, quitar los pases actuales cambia poco el tiempo. Al apagar el optimizador de Polars sí aparecen penalizaciones claras en varias tareas. O0 solo quiere decir sin optimizaciones de CaPybara; Polars conserva las suyas. Esto nos orienta hacia optimizaciones que aprovechen información que el DSL conoce, como contratos, orden estable y reutilización de subplanes.

**Transición:** 13 de 16 errores se detectan al compilar.

**Fuente:** reporte/generado_v2/figuras/optimizaciones.png; reporte/generado_v2/tablas/optimizaciones.tex.

**Gráfico original:** `reporte/generado_v2/figuras/optimizaciones.png`

## 13. Detectar el error antes también es parte del valor

**Idea:** 13 de 16 errores se detectan al compilar.

CaPybara: 13 al compilar, 2 al ejecutar y 1 sin detectar.
Polars: 7 al ejecutar y 9 silenciosos en este corpus.
La verificación depende de la información disponible.

**Pie de la diapositiva:** Corpus propio de 16 casos: no representa todos los errores posibles ni su frecuencia en proyectos reales.

**Para exponer:** Volvamos al tiempo de la analista: una columna mal escrita o una comparación de tipos incompatibles puede obligarla a volver atrás. En un corpus propio de dieciséis casos, CaPybara detecta trece durante la compilación y dos más al ejecutar. Polars deja nueve de estos casos pasar sin un error; no quiere decir que falle en cualquier programa, sino que estos contratos no forman parte de lo que le pedimos validar. CaPybara tampoco cubre todo: una división insegura permanece sin detectar.

**Transición:** Omisiones de ; en CaPybara: de 12 a 0.

**Fuente:** reporte/generado_v2/figuras/errores.png; reporte/generado_v2/tablas/errores.tex.

**Gráfico original:** `reporte/generado_v2/figuras/errores.png`

## 14. El LLM también necesita una gramática clara

**Idea:** Omisiones de ; en CaPybara: de 12 a 0.

60 tareas compatibles del corpus adaptado de Anka.
Guía inicial: CaPybara 42/60; Polars 48/60.
Guía reforzada: CaPybara 50/60; Polars 41/60.
Una respuesta por tarea, sin correcciones.

**Pie de la diapositiva:** Exploratorio: mismo corpus para ajustar la guía; Polars varió con el mismo prompt. Junie Lite / Qwen3.6-27B-FP8.

**Para exponer:** Inspirados por Anka, probamos si un LLM puede escribir CaPybara con una guía del lenguaje. Seleccionamos sesenta tareas compatibles de las ochenta adaptadas y registramos veinte exclusiones; no es una réplica idéntica del artículo de Anka. Reforzar el punto y coma eliminó los errores de ese tipo, pero no demuestra por sí solo superioridad general. El prompt se ajustó tras observar errores del mismo corpus y Polars cambió de resultado aun con su prompt idéntico. Se cuentan también fallos de formato de Junie; hace falta repetir con más muestras y modelos.

**Transición:** Hacer menos trabajo. Expresar más casos. Medir con personas.

**Fuente:** reporte/generado_v2/figuras/usabilidad_llm.png; bench-LLM/resultados/junie-20261115-polars; bench-LLM/resultados/junie-20261115-polars-punto-coma.

**Gráfico original:** `reporte/generado_v2/figuras/usabilidad_llm.png`

## 15. Lo que falta es una hoja de ruta concreta

**Idea:** Hacer menos trabajo. Expresar más casos. Medir con personas.

RENDIMIENTO · quitar orden innecesario y reutilizar nodos con varias salidas.
COBERTURA · fechas, ventanas y UNION; JOIN requiere la forma de grafo.
EVIDENCIA · medir tiempo y comprensión con personas; replicar con otros LLMs.

**Pie de la diapositiva:** También falta ampliar contratos dependientes de datos. Las propuestas no se presentan como funciones ya implementadas.

**Para exponer:** Los límites de las mediciones se convierten en una hoja de ruta. Podemos quitar orden estable cuando un ordenamiento posterior lo vuelve innecesario y evitar recalcular los mismos nodos para varias salidas. El lenguaje todavía necesita funciones de fecha, ventanas y UNION; JOIN ya existe, pero en la forma de grafo. Finalmente, debemos comprobar con personas si la sintaxis reduce esfuerzo o tiempo y usar un conjunto independiente para el benchmark de LLMs.

**Transición:** Rendimiento, escritura declarativa y una sintaxis compacta.

**Fuente:** reporte/main_v2.tex, discusión, limitaciones y trabajo futuro.

## 16. Tres fortalezas, una misma idea

**Idea:** Rendimiento, escritura declarativa y una sintaxis compacta.

TAN RÁPIDO COMO POLARS
0–7 % de sobrecosto en 4/5 tareas en SF 30.
Excepción: limpieza, 4,35×.

TAN FÁCIL DE ESCRIBIR COMO SQL
FROM · WHERE · GROUP_BY · SUM.
Una propuesta de diseño; falta un estudio con personas.

CON MENOS TOKENS
508 frente a 652 de Polars: 22 % menos.
Tokens léxicos en cinco tareas, no tokens de LLM.

**Pie de la diapositiva:** Rendimiento cercano en los casos medidos; facilidad como SQL es una intención de diseño. Menos tokens se compara con Polars.

**Para exponer:** Podemos resumir el proyecto en las tres fortalezas que buscamos reunir. La primera es aprovechar el motor Polars y acercarnos a su rendimiento, como muestran cuatro de las cinco tareas, manteniendo visible la excepción. La segunda es escribir la intención de forma declarativa y con vocabulario familiar de SQL; todavía no demostramos con personas que sea igual de fácil. La tercera sí es una medición del código: un veintidós por ciento menos de tokens léxicos que Polars en las tareas evaluadas. No afirmamos menos tokens que SQL ni menos líneas de código.

**Transición:** Que responder cuánto vendimos sea el centro del trabajo.

**Fuente:** reporte/generado_v2/figuras/panorama.png; reporte/generado_v2/figuras/expresividad.png; docs/lenguaje.md.

## 17. Volvamos a la pregunta de las 9:00

**Idea:** Que responder cuánto vendimos sea el centro del trabajo.

Ana: 150 · Luis: 80.
La transformación se lee como una secuencia de decisiones.
El compilador revisa lo que puede saber antes de ejecutar.
Polars procesa el plan generado.

Menos fricción al escribir. Polars al ejecutar.

**Pie de la diapositiva:** Rafael Ramos Huamani · Gabriel Vargas Urmeneta
David Silva Mena · Angel Tribeño Hurtado
github.com/rafram96/proyecto2-compis

**Para exponer:** Cerramos la misma historia con la que empezamos: la analista quería responder una pregunta sobre ventas. CaPybara hace explícitos los pasos y sus contratos, y se apoya en Polars para ejecutarlos. El proyecto entrega un compilador completo, un entorno web y evidencia reproducible; no promete un ahorro de minutos que todavía no medimos. Podemos continuar con la demostración del ejemplo y responder preguntas.

**Transición:** Abrir preguntas o demostrar el programa de ventas.

**Fuente:** Repositorio del proyecto; antecedentes: Popović et al. 2024, Heltweg et al. 2025, Al Mazrouei 2025.

## Referencias principales

- Saif Khalfan Saif Al Mazrouei (2025). [Anka: A Domain-Specific Language for Reliable LLM Code Generation](https://arxiv.org/abs/2512.23214). PDF proporcionado: `2512.23214v1.pdf`; páginas 1, 6–7.
- Aleksandar Popović, Vladimir Ivković, Nikola Trajković, Ivan Luković (2024). [A domain-specific language for managing ETL processes](https://doi.org/10.7717/peerj-cs.1835). PDF proporcionado: `peerj-cs-1835.pdf`; páginas 1–3, 19, 21–22.
- Philip Heltweg, Georg-Daniel Schwarz, Dirk Riehle (2025). [Can a Domain-Specific Language Improve Program Structure Comprehension of Data Pipelines? A Mixed-Methods Study.](https://arxiv.org/abs/2505.16764). PDF proporcionado: `2505.16764v2.pdf`; páginas 1, 12–13.
