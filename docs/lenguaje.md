# Referencia del lenguaje ETL

Referencia de la sintaxis ETL-DSL v0.2 tal como la implementan `etl_dsl/grammar.lark`,
`validation.py`, `semantic.py` y `backend.py`. Para un recorrido guiado desde un CSV
hasta un archivo de salida, véase el [tutorial](tutorial.md).

## Programa y declaraciones

Un archivo contiene uno o más `PIPELINE nombre { ... }`. Cada pipeline contiene
una o más declaraciones y exactamente un `FLOW`, colocado al final. Los nombres
distinguen mayúsculas y minúsculas; las palabras clave se escriben en mayúsculas
(`filter` no es `FILTER`). Los comentarios comienzan con `//` y terminan al final
de la línea.

```text
INPUT entrada: TABLE[id: INT, importe: DECIMAL?];
OUTPUT salida: TABLE;
OUTPUT tipada: TABLE[id: INT];
SOURCE datos = CSV(file: "datos.csv");
SOURCE tipados: TABLE[id: INT] = DUCKDB(file: "datos.duckdb", table: "ventas");
SINK destino = PARQUET(file: "salida.parquet");
USE otro_pipeline AS instancia;
```

`INPUT` y `OUTPUT` describen puertos lógicos; `SOURCE` y `SINK` describen acceso
físico. `INPUT` exige esquema; `OUTPUT` admite `TABLE` sin columnas conocidas.
`SOURCE` admite una anotación opcional, que debe enumerar columnas (`TABLE` solo
no está permitido). Los esquemas explícitos son no vacíos y no admiten nombres de
campo duplicados. Los tipos son `INT`, `DECIMAL`, `STRING`, `BOOL`, `DATE` y
`DATETIME`; `?` indica que la columna admite `NULL`. Los nombres de pipelines,
declaraciones y columnas empiezan por letra o `_` y continúan con letras, dígitos
o `_`. Dos declaraciones de un mismo pipeline no pueden compartir nombre.

Los conectores reciben argumentos nombrados, sin repetir, con valores literales:
números (también negativos), cadenas entre comillas dobles con escapes JSON,
`TRUE`, `FALSE` y `NULL`. No aceptan expresiones ni llamadas a funciones. La
gramática admite esos literales, pero las opciones de los conectores actuales son
cadenas, salvo `header`, que es booleana: un número o `NULL` como opción se
rechaza con `E_CONNECTOR`. Los conectores son `CSV`, `PARQUET`, `SQLITE` (solo
`SOURCE`) y `DUCKDB`; sus opciones están en [backend_polars.md](backend_polars.md).

## Operaciones

Cada operación se declara como `STEP nombre = OPERACION { ... }`, sin punto y
coma después del cierre. El bloque describe la transformación; `FLOW` aporta
sus entradas.

| Operación | Contenido del bloque |
| --- | --- |
| `FILTER` | `WHERE importe > 0 AND importe IS NOT NULL;` |
| `SELECT` | `COLUMNS id, importe;` |
| `DERIVE` | `neto = importe * 0.9; etiqueta = UPPER(nombre);` |
| `AGGREGATE` | `GROUP_BY id; SUM(importe) AS total; COUNT() AS n;` |
| `JOIN` | `TYPE LEFT; ON left.id == right.cliente_id;` |
| `SORT` | `BY importe DESC, id ASC;` |
| `DISTINCT` | `COLUMNS id, fecha;` |
| `RENAME` | `id AS cliente_id;` |
| `FILL_NULL` | `importe = 0; nombre = "UNKNOWN";` |
| `DROP_NULLS` | `COLUMNS importe, nombre;` |

`GROUP_BY` es opcional; sin él, `AGGREGATE` produce una sola fila. Las
agregaciones son `COUNT`, `SUM`, `AVG`, `MIN` y `MAX`. Solo `COUNT()` admite cero
argumentos y cuenta filas; `COUNT(expr)` cuenta los valores no nulos. Las
restantes requieren una expresión (`E_ARITY`). Las listas de columnas, claves de
orden, asignaciones, alias y renombres no admiten repetidos (`E_DUPLICATE`).

Los JOIN admiten `INNER`, `LEFT`, `RIGHT` y `FULL`, y varias igualdades conectadas
con `AND`; cada igualdad debe conectar una columna `left` con otra `right`
(`E_JOIN_CONDITION`). El resultado conserva todas las columnas de ambos lados,
incluidas las dos claves, por lo que los nombres de un lado no pueden repetirse en
el otro, ni siquiera cambiando mayúsculas (`E_AMBIGUOUS_COLUMNS`): por ejemplo,
`left.id == right.id` requiere un `RENAME` previo. `SORT` usa `ASC` cuando se
omite la dirección y deja los `NULL` al final.

## Expresiones

Precedencia de menor a mayor:

1. `OR`
2. `AND`
3. `NOT`
4. `==`, `!=`, `<`, `<=`, `>`, `>=`, `IS NULL`, `IS NOT NULL`
5. `+`, `-`
6. `*`, `/`
7. `-` unario
8. Literales, columnas, llamadas y paréntesis

Los operadores aritméticos binarios asocian por la izquierda. No se permiten
comparaciones encadenadas (`a < b < c` es un error de sintaxis); se deben conectar
mediante `AND`. La asignación usa `=`, la comparación de igualdad usa `==`.
Los números sin punto ni exponente son enteros; los demás (`1.18`, `1e3`) son
decimales exactos. Las cadenas usan comillas dobles y escapes JSON; los booleanos
son `TRUE` y `FALSE`.

Las funciones escalares son `COALESCE` (al menos dos argumentos), `NULLIF` y
`SAFE_DIVIDE` (dos argumentos), `LOWER`, `UPPER` y `TRIM` (un argumento); otra
cantidad produce `E_ARITY`. Se permiten llamadas anidadas. La gramática admite
referencias `columna` o `calificador.columna`, pero el análisis estático solo
acepta calificadores `left` y `right` en condiciones JOIN (`E_QUALIFIER`). En las
demás operaciones se usan columnas sin calificar. `TRIM` quita solo espacios.

Las comparaciones directas con el literal `NULL` se parsean pero se rechazan en
la validación (`E_NULL_COMPARISON`): se debe escribir `IS NULL` o `IS NOT NULL`.
La ejecución sigue la lógica de tres valores de SQL: una comparación o una
operación aritmética con un valor nulo da `NULL`; `FALSE AND x` es `FALSE` y
`TRUE OR x` es `TRUE` aunque `x` sea `NULL`. `FILTER` conserva solo las filas cuya
condición es `TRUE`. `COALESCE` devuelve el primer argumento no nulo; `NULLIF(a,b)`
devuelve `NULL` cuando `a == b`; `SAFE_DIVIDE(a,b)` devuelve `NULL` cuando `b` es 0
o nulo. `SUM`, `AVG`, `MIN` y `MAX` ignoran nulos, y la suma de un grupo sin
valores es `NULL`, no 0. Las claves nulas de un JOIN no coinciden entre sí.

`DERIVE` agrega columnas nuevas; `FILL_NULL` reemplaza nulos de columnas
existentes. Sus asignaciones usan el esquema de entrada del bloque, sin depender
de las otras asignaciones del mismo bloque. `DISTINCT` proyecta las columnas
listadas y elimina combinaciones repetidas, en el orden de su primera aparición.
Cuando el esquema es conocido, el análisis estático rechaza estas violaciones
(`E_AMBIGUOUS_COLUMNS` para un `DERIVE` que reutiliza un nombre, `E_COLUMN` para
una referencia o destino inexistente); el runtime las vuelve a comprobar.

## Conexiones y composición

```text
FLOW {
    datos -> limpieza -> instancia.entrada;
    instancia.salida -> union.left;
    clientes -> union.right;
    union -> resultado;
}
```

Cada cadena equivale a conexiones por pares consecutivos. Se admite ramificar
una salida hacia varios consumidores. Cada transformación simple, `SINK` y
`OUTPUT` requiere exactamente una entrada; un JOIN requiere exactamente una en
`.left` y una en `.right`. `INPUT` y `SOURCE` solo producen datos y deben usarse.
Un JOIN produce datos a través de su nombre sin puerto. `SINK` y `OUTPUT` solo
consumen datos.

Las instancias `USE` consumen mediante sus `INPUT` declarados y producen mediante
sus `OUTPUT`. Se permiten referencias a pipelines definidos después. Se rechazan
instancias de pipelines desconocidos, recursión entre pipelines, ciclos del flujo,
enlaces repetidos y puertos inexistentes o usados en la dirección incorrecta.
El chequeo de ciclos representa cada instancia `USE` como un nodo indivisible.
Cada `USE` verifica sus entradas contra los `INPUT` del pipeline instanciado y
publica un esquema por cada `OUTPUT`; varias instancias del mismo pipeline son
independientes.

## AST y destino Polars

Los nodos del AST son dataclasses inmutables y conservan línea y columna (base 1),
así como offsets (base 0, extremo final exclusivo). Los literales decimales usan
`decimal.Decimal` sin conversión a float; en la salida JSON su valor es texto
para conservar precisión. El AST distingue tablas desconocidas de tablas tipadas
y conserva los conectores sin acceder a ellos.

Los contratos se comprueban sobre los tipos del motor sin realizar casts:
`INT` acepta enteros de Polars; `DECIMAL` es una familia numérica que admite
enteros, decimales y reales; `STRING` corresponde a `String`, `BOOL` a `Boolean`,
`DATE` a `Date` y `DATETIME` a `Datetime`. No se fija precisión/escala en el
DSL actual. Los nombres de columna se comprueban con su capitalización exacta;
se rechazan columnas de salida que difieran solo en mayúsculas, para que los
resultados puedan escribirse también en DuckDB. Las columnas sin `?` se verifican
contra los datos para rechazar nulos en `SOURCE`, `INPUT` y `OUTPUT` tipados.
Los contratos exigen también las mismas columnas en el mismo orden.

Se usa `parser="lalr"`, `lexer="contextual"`, `propagate_positions=True` y
`maybe_placeholders=False`, según la [API oficial de Lark](https://lark-parser.readthedocs.io/en/stable/classes.html).
La gramática se distribuye dentro del paquete Python para que el parser también
funcione instalado fuera del repositorio.

## Organización y ejecución

`scanner.py` configura Lark y ofrece la inspección de tokens (`scan`);
`token.py` define `Token` y `Span`; `parser.py` analiza la sintaxis;
`visitor.py` contiene `ASTBuilder`, `NodeVisitor` y el recorrido `walk`;
`ast.py` define los nodos y `type.py` define los tipos escalares.
`validation.py` comprueba la estructura, `ir.py` baja el AST a IR, `semantic.py`
infiere esquemas, `passes.py` optimiza, `backend.py` genera Python y `runtime.py`
lo ejecuta; `analysis.py` reúne las fases para la CLI y la web.
El scanner aislado usa el lexer básico de Lark: una palabra clave puede recibir
una categoría distinta cuando el parser la interpreta como nombre mediante el
lexer contextual.

Desde la raíz del proyecto, `python main.py` procesa los archivos `.etl` de
`input/` recursivamente y guarda el Python compilado en `output/` con extensión `.py`.
Cada archivo se valida por separado. Se conservan subcarpetas, se omiten otras
extensiones y se continúa después de errores en un archivo. El estado final es
`1` si algún archivo falló o si no se encontraron programas; en otro caso es `0`.
El código se genera solo después de validar el programa; no se eliminan
artefactos de ejecuciones anteriores.

`--format` elige la salida: `python` (predeterminada), `check`, `ast`, `ir`,
`tree` o `tokens`. Al procesar una carpeta, o con `--output`, se guardan como
`.py`, `.ast.json`, `.ir.txt`, `.tree.txt` y `.tokens.json`; con un archivo
individual, los formatos de inspección se muestran en consola y `python` se guarda
en `output/`. `--format check` solo valida e informa la cantidad de pipelines.
`python main.py otra_entrada --output otra_salida` cambia las rutas. `--run`
(solo con `--format python`) ejecuta los pipelines con Polars después de compilar;
`--pipeline nombre` (repetible, requiere `--run`) los selecciona. `-O0` desactiva
los pases y `--pases a,b` los elige en orden; ambas opciones son excluyentes y un
pase desconocido es un error. Los `.py` también pueden ejecutarse directamente,
con el paquete `etl_dsl` instalado. Más detalles en [backend_polars.md](backend_polars.md).

## Comprobación estática

C2 propaga esquemas, tipos y nulabilidad antes de optimizar, sin consultar datos.
Detecta columnas inexistentes sobre esquemas completos (`E_COLUMN`), predicados no
booleanos y operandos incompatibles (`E_TYPE`), contratos imposibles (`E_SCHEMA`,
`E_TYPE`), nombres ambiguos (`E_AMBIGUOUS_COLUMNS`) y calificadores fuera de JOIN
(`E_QUALIFIER`). Conserva conocimiento parcial cuando `SOURCE` no tiene contrato:
en ese caso una columna mal escrita solo se detecta al ejecutar. Las
[reglas semánticas](semantica_estatica.md) describen las diez operaciones y los
chequeos que permanecen en ejecución.

## Garantía local de JOIN (C4)

Después de ON se admite `VERIFY MANY_TO_ONE;`, únicamente para INNER JOIN de
clave simple. Exige clave derecha única, claves no nulas en ambos lados, dtype
físico idéntico y referencia total desde la izquierda. El runtime verifica la
garantía aun con -O0 y conserva el orden izquierdo. Los datos inválidos fallan
con un código de contrato; nullable no implica coincidencia de NULL.
La garantía pertenece a las entradas exactas del JOIN, después de sus operaciones.
No es una declaración de integridad global ni una prueba estática.

El pase `joins` elimina la combinación de columnas cuando todos los consumidores
inmediatos son SELECT exclusivos del lado izquierdo, manteniendo ambas lecturas
y la obligación. La clave derecha también cuenta como columna observable.
OUTPUT y SINK no proyectan; USE directo constituye una barrera conservadora.
Ejemplo completo: [demo/joins.etl](../demo/joins.etl). Reglas, errores y vacíos:
[optimizacion_joins.md](optimizacion_joins.md).
