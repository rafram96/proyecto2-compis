# Referencia del lenguaje ETL

## Programa y declaraciones

Un archivo contiene uno o más `PIPELINE nombre { ... }`. Cada pipeline contiene
una o más declaraciones y exactamente un `FLOW`, colocado al final. Los nombres
distinguen mayúsculas y minúsculas; las palabras clave se escriben en mayúsculas.
Los comentarios comienzan con `//` y terminan al final de la línea.

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
`SOURCE` admite una anotación opcional. Los esquemas explícitos son no vacíos y
no admiten nombres de campo duplicados. Los tipos son `INT`, `DECIMAL`, `STRING`,
`BOOL`, `DATE` y `DATETIME`; `?` indica nulabilidad.

Los conectores aceptan argumentos nombrados con valores literales: números,
cadenas entre comillas dobles con escapes JSON, `TRUE`, `FALSE` y `NULL`. Los
números negativos también están permitidos. No aceptan expresiones ni llamadas
a funciones como argumentos. El backend valida sus opciones al generar Python.

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

`GROUP_BY` es opcional. Las agregaciones son `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`.
Solo `COUNT()` admite cero argumentos; las restantes requieren una expresión.
Los JOIN admiten `INNER`, `LEFT`, `RIGHT`, `FULL` y varias igualdades conectadas
con `AND`; cada igualdad debe conectar una columna `left` con otra `right`.
`SORT` usa `ASC` cuando se omite la dirección.

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
comparaciones encadenadas (`a < b < c`); se deben conectar mediante `AND`.
La asignación usa `=`, la comparación de igualdad usa `==`.

Las funciones escalares son `COALESCE` (al menos dos argumentos), `NULLIF` y
`SAFE_DIVIDE` (dos argumentos), `LOWER`, `UPPER` y `TRIM` (un argumento).
Se permiten llamadas anidadas. La gramática admite referencias `columna` o
`calificador.columna`; el backend actual solo admite calificadores `left` y
`right` en condiciones JOIN. En otras operaciones se usan columnas sin calificar.

Las comparaciones directas con el literal `NULL` se parsean pero se rechazan en
la validación: se debe escribir `IS NULL` o `IS NOT NULL`. La ejecución en
Polars sigue la lógica de tres valores de SQL; `FILTER` conserva solo `TRUE`.
`SAFE_DIVIDE(a,b)` devuelve `NULL` cuando `b` es 0.

`DERIVE` agrega columnas; `FILL_NULL` reemplaza nulos de columnas existentes.
Sus asignaciones usan el esquema de entrada del bloque, sin depender de las
otras asignaciones del mismo bloque. `DISTINCT` proyecta las columnas listadas
y elimina combinaciones repetidas. El runtime verifica estas restricciones.

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

`--format ast` guarda `.ast.json`; `--format tree` guarda `.tree.txt`;
`--format tokens` guarda `.tokens.json`;
`--format check` solo valida. Se pueden cambiar las rutas con
`python main.py otra_entrada --output otra_salida`. `--run` ejecuta los pipelines
con Polars después de compilar. Los `.py` también pueden ejecutarse directamente,
con el paquete `etl_dsl` instalado. Más detalles en [backend_polars.md](backend_polars.md).
