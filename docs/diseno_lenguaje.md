# Diseño del lenguaje (borrador v0.1)

> Objetivos 3, 4 y 5 del enunciado: sintaxis concreta y abstracta, gramática, semántica y
> sistema de tipos. Este documento es la referencia para implementar el parser y el verificador.

---

## 1. Principios de diseño

1. **Para personas que no programan, pero con estructura de lenguaje.** Las palabras clave
   están en español, hay bloques con llaves y pasos con nombre. Se lee casi como prosa, pero no
   es ambiguo.
2. **Cada instrucción empieza con una palabra reservada** (`fuente`, `paso`, `filtrar`,
   `calcular`…). Así la gramática sigue siendo LALR y no hacen falta separadores como `;`
   ni sangría significativa.
3. **Una sola forma de escribir cada cosa.** No hay sinónimos (no existen a la vez `filtrar` y
   `quedarse con`).
4. **Los esquemas se infieren y las reglas son opcionales.** El usuario no tiene que declarar
   tipos; si escribe `reglas`, el compilador las usa para verificar y optimizar.
5. **Errores en términos del dominio**, con la línea, la causa y una sugerencia de corrección.
6. **Rigor en el compilador, no en la superficie.** Los tipos, la nulabilidad, los rangos y
   las claves existen siempre, aunque el usuario no los escriba.

---

## 2. Programa de ejemplo

```text
# Ventas web por región
pipeline ventas_por_region {

  fuente ventas   = csv("data/ventas.csv")
  fuente clientes = excel("data/clientes.xlsx")

  reglas ventas {
    id         : entero unico
    cliente_id : entero referencia clientes.id
    monto      : decimal en [0, 1000000]
    descuento  : decimal opcional en [0, 1]
    canal      : texto uno_de("web", "tienda")
  }

  paso ventas_web = ventas
    filtrar monto > 100 y canal == "web"
    calcular neto = monto * (1 - descuento ?? 0)

  paso por_region = ventas_web
    unir clientes en cliente_id = clientes.id
    agrupar por region {
      total    = suma(neto)
      cantidad = contar()
    }

  reglas por_region {
    total : decimal en [0, 1000000000]
  }

  guardar por_region en "out/region.xlsx"
}
```

Un bloque `reglas` sobre un **paso** funciona como una *expectativa* sobre el resultado. El
compilador intenta demostrarla; si no puede, genera la verificación en tiempo de ejecución
(optimización O2).

---

## 3. Elementos léxicos

| Elemento | Forma | Ejemplo |
|---|---|---|
| Identificador | letra (incluye `áéíóúñü`) seguida de letras, dígitos o `_` | `cliente_id`, `año` |
| Entero | dígitos, con `_` opcional como separador de miles | `1_000_000` |
| Decimal | con **punto** como separador decimal | `0.18` |
| Texto | entre comillas dobles | `"web"` |
| Booleano | `verdadero`, `falso` | |
| Comentario | `#` hasta el fin de la línea | `# nota` |
| Operadores | `+ - * / == != < <= > >= ?? =` | |

**Palabras reservadas:** `pipeline fuente reglas paso guardar en filtrar seleccionar quitar
renombrar a calcular unir izquierda agrupar por ordenar ascendente descendente y o no
verdadero falso entero decimal texto booleano fecha fechahora opcional unico uno_de
referencia csv excel parquet`

El lexer debe aceptar las palabras clave con y sin tilde cuando la lleven, y un mensaje de
error debe sugerir la palabra correcta (`filtar` → *¿quisiste decir `filtrar`?*).

---

## 4. Gramática (EBNF)

```ebnf
programa     = { pipeline } ;
pipeline     = "pipeline" IDENT "{" { declaracion } "}" ;
declaracion  = fuente | reglas | paso | guardar ;

(* Fuentes y salidas *)
fuente       = "fuente" IDENT "=" formato "(" TEXTO ")" ;
formato      = "csv" | "excel" | "parquet" ;
guardar      = "guardar" IDENT "en" TEXTO ;              (* formato por extensión *)

(* Reglas: contratos sobre fuentes o pasos *)
reglas       = "reglas" IDENT "{" { regla } "}" ;
regla        = IDENT ":" tipo { restriccion } ;
tipo         = "entero" | "decimal" | "texto" | "booleano" | "fecha" | "fechahora" ;
restriccion  = "opcional"
             | "unico"
             | "en" "[" literal "," literal "]"
             | "uno_de" "(" literal { "," literal } ")"
             | "referencia" IDENT "." IDENT ;

(* Pasos *)
paso         = "paso" IDENT "=" IDENT { operacion } ;
operacion    = filtrar | seleccionar | quitar | renombrar
             | calcular | unir | agrupar | ordenar ;

filtrar      = "filtrar" expr ;
seleccionar  = "seleccionar" lista_ident ;
quitar       = "quitar" lista_ident ;
renombrar    = "renombrar" IDENT "a" IDENT { "," IDENT "a" IDENT } ;
calcular     = "calcular" asignacion { "," asignacion } ;
unir         = "unir" [ "izquierda" ] IDENT "en" par { "y" par } ;
par          = columna "=" columna ;
agrupar      = "agrupar" "por" lista_ident "{" { asignacion } "}" ;
ordenar      = "ordenar" "por" criterio { "," criterio } ;
criterio     = IDENT [ "ascendente" | "descendente" ] ;

asignacion   = IDENT "=" expr ;
lista_ident  = IDENT { "," IDENT } ;
columna      = IDENT [ "." IDENT ] ;

(* Expresiones, de menor a mayor precedencia *)
expr         = disyuncion ;
disyuncion   = conjuncion { "o" conjuncion } ;
conjuncion   = negacion { "y" negacion } ;
negacion     = "no" negacion | comparacion ;
comparacion  = suma [ op_comp suma ] ;                  (* no se encadenan *)
op_comp      = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
suma         = producto { ( "+" | "-" ) producto } ;
producto     = unario { ( "*" | "/" ) unario } ;
unario       = "-" unario | por_defecto ;
por_defecto  = atomo [ "??" atomo ] ;                   (* une más fuerte que la aritmética *)
atomo        = literal | columna | llamada | "(" expr ")" ;
llamada      = IDENT "(" [ expr { "," expr } ] ")" ;
literal      = ENTERO | DECIMAL | TEXTO | "verdadero" | "falso" ;
```

**Decisión de precedencia de `??`.** En C# o JavaScript, `1 - descuento ?? 0` se lee como
`(1 - descuento) ?? 0`. Para nuestros usuarios, lo natural es "descuento, o 0 si está vacío",
así que `??` **une más fuerte que la aritmética**. Es un buen ejemplo de diseño guiado por el
dominio para el reporte.

**Asociatividad:** los operadores binarios asocian a la izquierda. Las comparaciones no se
encadenan, así que `0 < x < 5` es un error con sugerencia: `x > 0 y x < 5`.

---

## 5. Sintaxis abstracta (AST)

```text
Programa(pipelines: [Pipeline])
Pipeline(nombre, declaraciones: [Fuente | Reglas | Paso | Guardar])
Fuente(nombre, formato, ruta)
Reglas(objetivo, reglas: [Regla(columna, tipo, restricciones)])
Paso(nombre, entrada, operaciones: [Operacion])
  Operacion = Filtrar(cond) | Seleccionar(cols) | Quitar(cols) | Renombrar(pares)
            | Calcular(asignaciones) | Unir(tabla, pares, izquierda: bool)
            | Agrupar(claves, asignaciones) | Ordenar(criterios)
Guardar(tabla, ruta)
Expr = Literal | Columna(tabla?, nombre) | Binaria(op, izq, der) | Unaria(op, e)
     | PorDefecto(e, defecto) | Llamada(funcion, args)
```

Cada nodo guarda su posición (línea y columna) para los diagnósticos.

---

## 6. Semántica de las operaciones

Cada operación transforma un **esquema** (columnas con su tipo, nulabilidad y hechos: rango,
valores posibles, unicidad).

| Operación | Requiere | Esquema resultante |
|---|---|---|
| `fuente T = f(ruta)` | archivo legible al compilar | esquema inferido ⊕ `reglas T` (las reglas prevalecen) |
| `filtrar e` | `e : booleano` | mismo esquema; los hechos se refinan (p. ej. `monto > 100` ⇒ rango `(100, 1e6]`). Las filas donde `e` está vacía se descartan |
| `seleccionar c₁…cₙ` | las columnas existen | solo `c₁…cₙ`, en ese orden |
| `quitar c₁…cₙ` | las columnas existen | el resto |
| `renombrar a a b` | `a` existe y `b` no | igual, con `a` renombrada a `b` |
| `calcular x = e` | `e` bien tipada | añade `x`; si `x` ya existe, la reemplaza (con aviso) |
| `unir T en a = b` | tipos de `a` y `b` compatibles | columnas de ambas tablas. Con `izquierda`, las columnas de `T` pasan a `opcional` |
| `agrupar por k { x = agg }` | cada `x` usa una función de agregación | `k` + las `x`; la combinación de `k` pasa a ser `unico` |
| `ordenar por c` | `c` es comparable | mismo esquema |
| `guardar T en ruta` | extensión soportada | — |

**Semántica de ejecución:** todos los pasos son **inmutables**. Un paso nunca modifica su
entrada, sino que define una tabla nueva. Los pasos forman un DAG que se evalúa de forma
diferida, y solo se calcula lo que alguna instrucción `guardar` necesita.

---

## 7. Sistema de tipos (resumen)

- **Tipos:** `entero`, `decimal`, `texto`, `booleano`, `fecha`, `fechahora`, cada uno con o
  sin `opcional`.
- **Numéricos:** `entero ⊕ decimal → decimal`, y `/` siempre da `decimal`. No se permite `+`
  entre textos; para eso existe la función `concatenar(a, b)`.
- **Nulabilidad:** el resultado es `opcional` si algún operando lo es. `a ?? b` exige que `a` y
  `b` tengan el mismo tipo, y el resultado es no opcional si `b` no lo es.
- **Comparaciones:** solo entre tipos compatibles. Comparar con un texto que está fuera de
  `uno_de` es un error ("nunca se cumple").
- **Agregaciones:** `suma`, `promedio` y `minimo`/`maximo` sobre números (y `minimo`/`maximo`
  también sobre fechas), además de `contar()` y `contar_distintos(c)`.
- **Funciones escalares (MVP):** `mayusculas`, `minusculas`, `recortar`, `contiene`,
  `concatenar`, `año`, `mes`, `dia`, `fecha("AAAA-MM-DD")`, `redondear(x, n)`.

---

## 8. Decisiones pendientes

1. **Columnas de Excel con espacios o tildes** ("Monto Total"). Recomiendo normalizar
   automáticamente a `monto_total` y mostrar la correspondencia en un mensaje del compilador.
   Es mejor que obligar a usar comillas invertidas, difíciles de escribir en teclados en español.
2. **Nulabilidad de las columnas no declaradas.** Puede marcarse `opcional` si la muestra
   tiene vacíos, o siempre `opcional`. Lo segundo obligaría a escribir `??` en todas partes.
3. **Columnas con el mismo nombre en `unir`.** Puede ser un error que sugiera `renombrar`, o
   añadir un sufijo automático.
4. **`??` frente a `si_vacio(x, 0)`.** Hay que elegir cuál es más legible para no técnicos.
   Habría que medirlo en el experimento de usabilidad.
