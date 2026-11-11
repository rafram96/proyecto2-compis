# Análisis estático de Cauce (C2)

`etl_dsl/semantic.py` analiza la IR original en orden topológico, antes de ejecutar
cualquier pase. `analyze`, `build_ir` y `compile_program` comparten `infer`.
También se analizan nodos sin consumidores y pipelines usados mediante `USE`.
No se importa Polars, no se ejecuta código generado y no se abren conectores.

## Conocimiento representado

Cada esquema tiene columnas con nombre exacto, tipos posibles y nulabilidad:

- `complete=true`: todas las columnas y su orden son conocidos.
- `complete=false`: las columnas enumeradas son hechos parciales; pueden existir
  otras columnas. El orden enumerado no afirma la posición física en la tabla.
- `absent`: nombres cuya ausencia se ha demostrado, por ejemplo después de
  renombrar una columna. Una referencia puede fallar incluso en un esquema parcial.
- `types=null`: tipo desconocido; `types=[]`: dtype Null de Polars, diferente de
  desconocido. Una columna nullable de tipo INT continúa teniendo `types=["INT"]`.
- `nullable=true`: podría haber nulos, sin afirmar su existencia. `false` garantiza
  ausencia de nulos en las ejecuciones que satisfacen los contratos previos.

Los tipos internos son `INT`, `REAL`, `FIXED`, `STRING`, `BOOL`, `DATE`, `DATETIME`
y `DURATION`. `FIXED` representa decimal exacto; `REAL`, coma flotante. La familia
DSL `DECIMAL` incluye `INT`, `REAL` y `FIXED`, como el contrato del runtime.
`DURATION` puede resultar de restar fechas; no agrega una nueva declaración al DSL.
No se fijan anchos enteros, precisión/escala decimal ni unidades temporales.

`SOURCE` sin contrato comienza completamente desconocido. `INPUT` y `SOURCE`
tipados parten de sus contratos. Las garantías dependen de que el runtime los
compruebe; esos chequeos no se eliminan. No se inventa un tipo para una referencia
sobre una fuente desconocida. Por tanto, compilar correctamente no certifica los
datos ni las expresiones que siguen teniendo información desconocida.

## Expresiones y tipos

Se comprueban referencias, calificadores, operandos aritméticos, comparaciones,
operadores lógicos, predicados, funciones escalares y agregaciones. `WHERE` requiere
BOOL; una expresión conocida `monto + 1` o el literal NULL falla con `E_TYPE`.
Solo las condiciones de JOIN admiten `left` y `right`.

La promoción numérica conserva enteros en `+`, `-`, `*`, decimales exactos cuando
corresponde y reales al mezclarlos. La división de enteros produce REAL; la de
decimales puede conservar FIXED. Cuando el tipo es una familia, se conservan las
alternativas posibles. JOIN necesita tipos compatibles sin convertir las claves:
INT frente a REAL o FIXED conocidos falla; DECIMAL frente a INT puede ser válido.

Se conservan operaciones que soporta el backend: suma de cadenas, promoción de
booleanos con números, comparación numérica/temporal y resta temporal. `NOT`,
`AND` y `OR` siguen siendo operadores lógicos del DSL y exigen BOOL.
`COALESCE` y `FILL_NULL` usan el supertipo común, que también puede convertir a
STRING; no se confunden con contratos, que nunca convierten. Tipos sin supertipo
común conocido, como BOOL y DATE, se rechazan.

`LOWER`, `UPPER` y `TRIM` exigen STRING y conservan nulabilidad. `COALESCE` puede
ser nulo solo si todos sus argumentos pueden serlo. `NULLIF` conserva el tipo del
primer argumento y puede introducir nulos; comprueba compatibilidad de comparación.
`SAFE_DIVIDE` comprueba operandos numéricos (incluida promoción booleana), usa el
tipo de división y conserva la posibilidad de NULL por denominador cero.

## Transferencia de las diez operaciones

| Operación | Esquema y nulabilidad |
|---|---|
| FILTER | Conserva columnas y orden. Refina predicados de columna BOOL, columnas directas en comparaciones e `IS NOT NULL`. Propaga NOT con lógica de tres valores. Para AND une garantías; para OR conserva su intersección (se invierte bajo NOT). |
| SELECT | Proyecta exactamente las columnas indicadas y su orden; completa el conjunto de nombres aun si los tipos son desconocidos. |
| DERIVE | Añade columnas al final. Exige nombres nuevos, sin colisiones por mayúsculas. Todas las expresiones leen la entrada original. También rechaza dependencias laterales entre asignaciones con entrada desconocida. |
| AGGREGATE | Claves en orden, seguidas por aliases. COUNT con/sin expresión siempre INT no nulo. SUM, AVG, MIN y MAX globales pueden ser nulos por entrada vacía. Con GROUP_BY, conservan la posibilidad de nulos del argumento; los grupos emitidos no están vacíos. SUM/AVG comprueban tipos admitidos; SUM de BOOL es INT y AVG numérico es REAL. AVG de DATE produce DATETIME. |
| JOIN | Concatena columnas izquierdas y derechas, incluidas ambas claves (`coalesce=False`). Comprueba claves y ambigüedad por mayúsculas. INNER elimina nulos de las claves; LEFT hace nullable el lado derecho, RIGHT el izquierdo y FULL ambos. |
| SORT | Comprueba claves; conserva columnas, orden de columnas y tipos. |
| DISTINCT | Proyecta las columnas listadas, conserva sus tipos y nulabilidad. |
| RENAME | Renombrado simultáneo, mantiene posiciones y comprueba colisiones finales. Guarda los nombres retirados como ausentes. |
| FILL_NULL | Solo permite destinos existentes. Evalúa contra entrada original, usa el supertipo de COALESCE y elimina nulabilidad si el reemplazo no puede ser nulo. |
| DROP_NULLS | Conserva columnas y tipos; marca los destinos como no nulos. |

## OUTPUT y USE

Un contrato tipado exige nombres y orden exactos cuando se conocen. En esquemas
parciales, una columna conocida ajena al contrato también demuestra incompatibilidad.
Los tipos se rechazan solo si ninguna alternativa satisface el contrato. Por ejemplo,
un DECIMAL declarado podría contener enteros y no se rechaza automáticamente como
entrada INT. Una salida con dtype Null no satisface un contrato escalar, aunque
este admita valores nulos.

La posibilidad de nulos **no prueba** incumplimiento de un contrato no nullable:
una tabla puede estar vacía o no contener ningún nulo. Se conserva el chequeo de
valores del runtime y se refina el esquema posterior bajo su garantía.

Las definiciones adelantadas de pipelines se resuelven mediante sus nombres.
Cada pipeline se verifica con sus INPUT declarados. Cada USE comprueba todas las
entradas, vuelve a propagar con los tipos/nulabilidad más precisos de los bindings
y publica un esquema independiente por puerto OUTPUT. Se admiten múltiples
entradas, salidas e instancias; las garantías de una instancia no alteran otra.

## Diagnósticos, exposición y límites

Los códigos estables son `E_COLUMN`, `E_TYPE`, `E_SCHEMA`,
`E_AMBIGUOUS_COLUMNS` y `E_QUALIFIER`, con `phase="semantic"` y mensajes en español.
Los intervalos apuntan a expresiones, referencias, campos de contrato o al bloque
responsable de una colisión. Las listas de nombres conservan internamente posiciones
por identificador sin cambiar su serialización como strings en el AST.

El artefacto seleccionable `schemas` expone resultados de la **IR original**, con
la estructura `pipeline -> nodo -> puerto -> esquema`; `""` es el puerto ordinario.
Los nodos USE exponen puertos nombrados. OUTPUT y SINK muestran el esquema recibido
(después de comprobar el contrato si corresponde). Si hay errores semánticos,
`schemas`, la IR optimizada y Python quedan bloqueados; se conservan tokens, árbol,
AST e IR original solicitados. C2 introdujo `schemas` en la versión 2; C3
actualiza el contrato a versión 3 con hechos y pruebas O1. Véase
[api_analisis.md](api_analisis.md).

El análisis es conservador: no comprueba valores, overflow, precisión decimal,
anchos/unidades del motor, existencia de archivos ni inferencia de tipos de CSV.
Las operaciones posteriores sobre DURATION que no estén modeladas pierden el tipo
preciso; permanecen sujetas al runtime. No demuestra satisfacibilidad, filas no
vacías, unicidad ni rangos. La refinación de filtros cubre las formas descritas,
sin resolver implicaciones arbitrarias. C3 consume estas garantías para el pase [rangos](optimizacion_rangos.md).
C4 agrega [obligaciones locales de JOIN](optimizacion_joins.md); la compilación no lee datasets. Las diez operaciones actuales tienen reglas y pruebas de comportamiento.

C4 distingue la declaración `JoinGuarantee` de la prueba estática de uso de
columnas y de las obligaciones del runtime. No añade unicidad ni integridad a
Schema: no se heredan a través de transformaciones. CHECK_JOIN, creado solo tras
el análisis original, expone el esquema izquierdo a los SELECT. Los pases que
vuelven a inferir esquemas reconocen ese operador; los intervalos C3 se reinician
conservadoramente. El contrato público actual es versión 4.
