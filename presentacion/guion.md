# CaPybara: de pelear con el código a transformar datos

Siete diapositivas · Rafael Ramos Huamani · Gabriel Vargas Urmeneta · David Silva Mena · Angel Tribeño Hurtado

Los minutos del escenario inicial son ilustrativos. Los datos de rendimiento y LLMs proceden de la evidencia del proyecto.

## 1. Solo necesitábamos un resumen de ventas

- La pregunta: ¿cuánto vendió cada cliente?
- 8 min revisando sintaxis + 7 min corrigiendo columnas + 5 min resolviendo nulos = 20 min.
- Escenario ilustrativo: el tiempo de desarrollo no fue medido en el proyecto.

**Visual:** Una línea de tiempo de 20 minutos, dividida en 8, 7 y 5 minutos. Etiqueta ILUSTRATIVO visible junto a la cifra, sin fotografías genéricas. Una tarjeta pequeña muestra el objetivo: ventas.csv → total por cliente.

**Notas para exponer:** Imaginemos que nos piden un resumen de ventas antes de una reunión. La transformación parece simple, pero tenemos que revisar nombres de columnas, recordar cómo escribir cada expresión y decidir qué hacer con los nulos. Estos veinte minutos son un escenario para plantear el problema: no medimos cuánto tarda una persona en programar. La pregunta del proyecto es si podemos reducir esa fricción sin renunciar a un motor eficiente.

**Transición:** ¿Y si pudiéramos escribir directamente lo que queremos hacer?

**Datos y alcance:** Los minutos son un ejemplo narrativo, no un resultado del benchmark ni una estadística de la industria. No afirmar que CaPybara ahorra 20 minutos.

## 2. ¿Y si bastara con expresar la transformación?

- CaPybara: un lenguaje específico para transformar tablas.
- Describe qué leer, limpiar, agrupar y guardar.
- Verifica columnas y tipos; genera Python que usa Polars.

**Visual:** Revelación del logo original de CaPybara, grande sobre blanco. Debajo: intención → CaPybara → Polars. Frase protagonista: Escribir la intención. Ejecutar con Polars. Autores en el pie con tipografía legible.

**Notas para exponer:** Así aparece CaPybara. Es un DSL, es decir, un lenguaje diseñado para un dominio específico: en este caso, extraer, transformar y guardar datos tabulares. En lugar de construir un motor desde cero, generamos código sobre Polars. La promesa es acercarnos a su rendimiento con una sintaxis centrada en las transformaciones y contratos que el compilador pueda revisar.

**Transición:** Veamos el mismo resumen de ventas escrito de principio a fin.

**Datos y alcance:** Usar Asset #1, logo original de CaPybara, sin redibujarlo ni sustituirlo por una foto de un animal. Equipo: Rafael Ramos Huamani · Gabriel Vargas Urmeneta · David Silva Mena · Angel Tribeño Hurtado. UTEC · CS3025 Compiladores.

## 3. Leer, limpiar, agrupar y guardar

- FROM declara el archivo y el esquema; ? permite nulos.
- FILL_NULL y FILTER preparan los montos.
- AGGREGATE suma por cliente; TO guarda el resultado.

**Visual:** Código real en panel monoespaciado grande, a la izquierda. A la derecha, dos tablas pequeñas de entrada y salida conectadas por una flecha. Priorizar el código y las tablas sobre las viñetas; no convertir el código en texto corrido ni perder los puntos y coma.

**Notas para exponer:** Leemos ventas.csv y declaramos dos columnas. El signo de interrogación permite que monto tenga valores faltantes. Rellenamos esos nulos con cero, conservamos los montos positivos y sumamos por cliente. El resultado tiene 150 para Ana y 80 para Luis. Las instrucciones terminan en punto y coma: también es importante al generar código con un LLM. El ejemplo se verifica con el compilador y el runtime del proyecto.

**Transición:** La ventaja no es solo cómo se lee: el compilador también entiende las tablas.

**Datos y alcance:** Código exacto:
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
Entrada, columnas cliente | monto: Ana | 120; Ana | NULL; Luis | 80; Ana | 30. Salida, columnas cliente | total: Ana | 150; Luis | 80. Mantener las cuatro filas y los resultados exactos.

## 4. Entender las tablas permite detectar errores antes

- Texto → análisis y tipos → optimizaciones → Python + Polars.
- 13 de 16 errores del corpus detectados al compilar; 2 más al ejecutar.
- 508 tokens frente a 652 en Polars: 22 % menos en las cinco tareas.

**Visual:** Flujo de cuatro bloques con un ejemplo de error: WHERE mnto > 0 → E_COLUMN: columna desconocida. Dos cifras destacadas: 13/16 y −22 % tokens. Evitar una lista completa de todas las fases del compilador.

**Notas para exponer:** El compilador primero lee la sintaxis, construye una representación del programa y comprueba sus columnas y tipos. Después transforma el plan y emite Python con la API diferida de Polars. Con un esquema declarado, puede rechazar una columna mal escrita sin abrir el archivo de datos. En nuestro corpus detectó trece errores en compilación y otros dos en ejecución; uno quedó sin detectar. También contamos un 22 % menos de tokens léxicos frente a Polars en cinco tareas, pero CaPybara ocupa más líneas: esa cifra no demuestra por sí sola que sea más fácil para las personas.

**Transición:** Pero si escribir es más cómodo, ¿cuánto cuesta al ejecutar?

**Datos y alcance:** Fuente: reporte/main_v2.tex; reporte/generado_v2/tablas/errores.tex y expresividad.tex. Compilación con esquema declarado, sin leer el archivo de datos. Corpus propio de 16 errores: 13 compilación, 2 ejecución, 1 no detectado. Tokens totales CaPybara 508; Polars manual 652; reducción 22,1 %. Son tokens léxicos, no tokens de un LLM. Líneas totales 78 frente a 61: no afirmar menos líneas ni usabilidad humana demostrada.

## 5. En cuatro tareas, muy cerca de Polars

- En SF 30: entre 0 % y 7 % de sobrecosto en cuatro de cinco tareas.
- Limpieza de pedidos: 4,35× el tiempo de Polars por preservar el orden.
- La ejecución se apoya en Polars; las optimizaciones del DSL aún pueden mejorar.

**Visual:** Gráfico horizontal de cinco razones CaPybara/Polars. Línea de referencia en 1,00, eje desde cero, cuatro barras cyan cerca de 1 y Limpieza en naranja a 4,35. Etiquetas claras: Resumen de precios 1,00; Ingreso por descuento 1,07; Ingreso por pedido 1,02; Limpieza de pedidos 4,35; Devoluciones 1,07. Un recuadro explica que un valor mayor significa más tiempo. No inventar intervalos ni usar bootstrap.

**Notas para exponer:** Comparamos las mismas cinco tareas en CaPybara, Polars manual, Pandas y DuckDB, verificando sus resultados antes de medir. Aquí aislamos la comparación con Polars en la escala más grande: cuatro tareas quedan entre cero y siete por ciento por encima. La excepción es limpieza, que tarda 4,35 veces más: preservar el orden obliga a hacer trabajo adicional. No afirmamos igualdad universal. Medimos diez repeticiones tras un calentamiento; la compilación, de 42 milisegundos de mediana, se mide por separado y no está en estas barras. Si mencionamos O0, significa Sin optimizaciones de CaPybara (O0); Polars mantiene su propio optimizador.

**Transición:** También preguntamos si un LLM puede escribir esta sintaxis de forma confiable.

**Datos y alcance:** Fuente: reporte/generado_v2/tablas/rendimiento.tex, razones de medianas en SF 30. Medianas en segundos CaPybara/Polars: Resumen 1,65/1,64; Descuento 1,21/1,13; Pedido 2,32/2,28; Limpieza 10,5/2,42; Devoluciones 13,0/12,2. Razones mostradas proceden del reporte y de medianas sin redondear. Protocolo: cinco tareas derivadas de TPC-H; SF 1, 10, 20 y 30; SF 30 tiene 180 millones de filas lineitem; un calentamiento y diez repeticiones por configuración. El tiempo medido excluye inicio de Python y compilación del DSL (mediana de compilación separada: 42 ms). Dos equipos iguales Core Ultra 9 285K, 64 GB RAM, Docker/WSL2 con límite de 31 GB. Consultas adaptadas sin filtros de fecha; no es TPC-H oficial completo.

## 6. Un punto y coma también cambia la historia

- 60 tareas compatibles, una respuesta por tarea y lenguaje, sin correcciones.
- Guía inicial: CaPybara 42/60 y Polars 48/60; guía reforzada: 50/60 y 41/60.
- Omisiones del ; en CaPybara: de 12 a 0. Resultado exploratorio.

**Visual:** Dos pares de barras con escala de 0 a 60: guía inicial (CaPybara 42, Polars 48) y guía reforzada de CaPybara (CaPybara 50, Polars 41). Recuadro cyan: errores por omitir ;, 12 → 0. Nota visible: mismo prompt de Polars; respuestas nuevas; no prueba superioridad general.

**Notas para exponer:** Adaptamos tareas de Anka y evaluamos el código que generó Junie Lite usando Qwen, sin mostrarle los tests ni corregir sus respuestas. Primero vimos errores recurrentes por olvidar el punto y coma obligatorio. Reforzamos la documentación con ejemplos correctos e incorrectos y los errores de ese tipo pasaron de doce a cero. En la segunda corrida, CaPybara resolvió cincuenta tareas y Polars cuarenta y una. Es una exploración: usamos el mismo corpus para ajustar la guía, y Polars varió incluso con el mismo prompt. Hace falta replicar con más modelos y un conjunto independiente.

**Transición:** Lo que falta nos marca la siguiente etapa del proyecto.

**Datos y alcance:** Fuente: bench-LLM/resultados/junie-20261115-polars y junie-20261115-polars-punto-coma; reporte/generado_v2/tablas/usabilidad_llm.tex. Junie Lite, Qwen/Qwen3.6-27B-FP8. Las tareas provienen de Anka: 60 seleccionadas de 80 y 20 exclusiones declaradas. Una muestra por tarea/lenguaje/corrida; sesiones nuevas fuera del repositorio y herramientas externas bloqueadas. El prompt de CaPybara se reforzó tras observar errores en el mismo corpus. El prompt de Polars se mantuvo idéntico, pero sus respuestas y resultados variaron. Se cuentan los fallos de formato de Junie. No llamarlo estudio con personas ni atribuir toda la mejora a la guía.

## 7. Menos fricción al escribir. Polars al ejecutar.

- Optimizar el orden estable y evitar recalcular salidas compartidas.
- Ampliar el lenguaje: funciones de fecha, ventanas y UNION; JOIN usa la forma de grafo.
- Medir tiempo y comprensión con personas; replicar el benchmark con más LLMs.

**Visual:** Tres tarjetas de próximos pasos: rendimiento, cobertura y evidencia. Logo original en una esquina. Cierre central grande con la frase del título y enlace corto legible al repositorio. Autores completos en el pie, sin comprimirlos hasta volverlos ilegibles.

**Notas para exponer:** Volvamos al analista del inicio: queremos que pueda concentrarse en la transformación y recibir errores útiles antes de procesar sus datos. Ya tenemos un compilador completo, un entorno web que permite ver sus fases y benchmarks reproducibles. El siguiente paso es quitar trabajo innecesario, ampliar la cobertura del lenguaje y medir si las personas realmente tardan menos y comprenden mejor los programas. CaPybara muestra que podemos expresar la intención con contratos claros y ejecutar sobre Polars; también deja identificados los casos donde aún debemos mejorar.

**Transición:** Abrir preguntas o demostrar el mismo ejemplo en el entorno web.

**Datos y alcance:** Proyecto: https://github.com/rafram96/proyecto2-compis. Reporte: reporte/main_v2.pdf. Autores: Rafael Ramos Huamani, Gabriel Vargas Urmeneta, David Silva Mena, Angel Tribeño Hurtado. No prometer ahorro de minutos medido ni rendimiento idéntico en todas las tareas.
