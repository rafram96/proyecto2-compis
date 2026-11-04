# Propuesta aterrizada — DSL para pipelines ETL → Python + Polars

> Versión de trabajo. Parte de la propuesta del grupo y del estado del arte recopilado
> (ETLCL, ETL-PL, Jayvee, pygrametl, Anka). Requisitos del curso en `Enunciado_DSL.md`.

---

## 1. Tesis del proyecto (lo que justifica el DSL)

Polars ya ofrece evaluación diferida y optimiza el plan. Un DSL que solo acorte la sintaxis
de Polars no aporta nada académicamente. La contribución tiene que estar en **lo que Polars
no sabe**: el contrato de los datos.

> **Tesis:** un DSL de pipelines ETL con *contratos de datos tipados* (esquema, nulabilidad,
> rangos, dominios enumerados, claves y cardinalidad de joins) permite **(1) detectar en
> compilación** errores que en Python/Polars aparecen tarde o nunca, y **(2) optimizar
> usando esos contratos**, algo que el optimizador de Polars no puede hacer porque no
> conoce esas garantías.

Diferencia frente al estado del arte:

| Trabajo | Qué hace | Qué no hace (nuestro hueco) |
|---|---|---|
| ETLCL (Popović 2024), ETL-PL (Petrović 2017/19) | Especifica el control y el flujo ETL de forma independiente de la plataforma | No hay un sistema de tipos de datos ni optimizaciones basadas en contratos |
| Jayvee (2025) | DSL pipes-and-filters con intérprete y estudio de comprensión | Es interpretado y no compila a un motor columnar optimizado |
| pygrametl (2021) | DSL interno en Python; prueba con *drawn tables* | Errores solo en ejecución; sin verificación estática |
| Polars a mano | Plan lazy optimizado | No conoce rangos, claves ni nulabilidad declarados |

**Alcance:** solo **transformación de datos** (un archivo = uno o varios pipelines con DAG de
pasos). La orquestación (cron, reintentos, cargas incrementales) queda **fuera**: es otro
dominio, ya lo cubren Airflow y Dagster, y no aporta a la parte de compiladores.

---

## 2. El lenguaje en un ejemplo

```text
schema Venta {
  id          : int unique
  cliente_id  : int references Cliente.id
  monto       : float in [0, 1_000_000]
  descuento   : float? in [0, 1]          # ? = admite nulos
  canal       : enum("web", "tienda")
  fecha       : date
}

schema Cliente {
  id     : int unique
  region : string
}

pipeline ventas_por_region {
  ventas   = source parquet "data/ventas.parquet" as Venta
  clientes = source csv     "data/clientes.csv"   as Cliente

  ventas
    |> filter monto > 100 and canal == "web"
    |> derive neto = monto * (1 - coalesce(descuento, 0))
    |> join clientes on cliente_id = id   many-to-one
    |> group by region aggregate total = sum(neto), n = count()
    |> output parquet "out/region.parquet"
       expect total >= 0
}
```

Código Python + Polars que se generaría (legible e idiomático):

```python
import polars as pl

def ventas_por_region() -> None:
    ventas = pl.scan_parquet("data/ventas.parquet")
    clientes = pl.scan_csv("data/clientes.csv",
                           schema={"id": pl.Int64, "region": pl.Utf8})
    # validación de contratos en la frontera (solo las que no se pudieron probar)
    _check_venta(ventas)

    result = (
        ventas
        .filter((pl.col("monto") > 100) & (pl.col("canal") == "web"))
        .with_columns(neto=pl.col("monto") * (1 - pl.col("descuento").fill_null(0)))
        .join(clientes, left_on="cliente_id", right_on="id", validate="m:1")
        .group_by("region")
        .agg(total=pl.col("neto").sum(), n=pl.len())
    )
    # `expect total >= 0` probado estáticamente → no se genera chequeo
    result.sink_parquet("out/region.parquet")
```

### Instrucciones

| Núcleo (MVP) | Fase 2 |
|---|---|
| `schema`, `source`, `filter`, `select`, `derive`, `output` | `join`, `group … aggregate`, `rename`, `sort`, `expect`, ramificación (un paso alimenta varias salidas) |

---

## 3. Sistema de tipos y verificaciones de dominio

**Tipos de columna:** `int`, `float`, `string`, `bool`, `date`, `datetime`, `enum(...)`;
modificador de nulabilidad `T?`; refinamientos `in [a, b]`; propiedades `unique` y
`references S.col`.

**Idea clave:** cada operación es una función `Esquema → Esquema` que además propaga
**hechos** (rangos, nulabilidad, unicidad). El verificador recorre el pipeline calculando
el esquema y los hechos en cada paso.

| Error detectado en compilación | Ejemplo | ¿Lo detecta Python/Polars? |
|---|---|---|
| Columna inexistente (con sugerencia) | `select regon` → *¿quisiste decir `region`?* | Solo al ejecutar, con un error genérico |
| Tipos incompatibles | `filter monto > "100"` | Solo al ejecutar |
| Clave de join con tipos distintos | `int` vs `string` | Solo al ejecutar |
| Nulos hacia una salida no nula | `descuento * 2` sin `coalesce` | **No** |
| Valor fuera del enum | `canal == "movil"` | **No** (el filtro devuelve 0 filas en silencio) |
| Filtro contradictorio con el rango | `monto > 2_000_000` | **No** |
| Cardinalidad de join imposible | `many-to-one` con clave derecha no `unique` | Solo en ejecución, y solo si se pasa `validate=` |
| Agregación mal formada | `aggregate total = neto` (sin función) | Solo al ejecutar |
| `expect` refutado estáticamente | `expect n < 0` | **No** |

Lo que no puede probarse estáticamente (los datos de entrada son externos) se compila a
**chequeos en tiempo de ejecución en la frontera**. Además, el compilador puede leer los
metadatos del Parquet al compilar para validar el esquema declarado contra el archivo.

Esta tabla es directamente la base del experimento **"Detección de errores"** del enunciado.

---

## 4. Arquitectura

```text
.fetl → Lexer/Parser (Lark, EBNF) → AST → Verificador (esquemas + hechos)
      → IR (DAG de operadores relacionales anotados) → Pases de optimización
      → Generador Python/Polars → ejecución
```

- **IR:** un DAG de nodos `Scan | Filter | Project | Derive | Join | Aggregate | Sink | Check`.
  Cada nodo lleva el esquema de salida, las columnas usadas y los hechos. No depende de Polars,
  lo que deja abierta la puerta a un backend SQL/DuckDB a futuro.
- **Stack:** Python en todo el compilador, **Lark** (LALR, conserva posiciones para los
  diagnósticos) en lugar de ANTLR, para no mezclar lenguajes. Polars con **versión fijada**.

---

## 5. Optimizaciones (se exigen ≥ 2, propias del dominio)

Clasificadas según si Polars ya las hace o no. Esto determina qué es medible como
contribución nuestra.

| # | Optimización | ¿Polars la hace? | Por qué es "de dominio" |
|---|---|---|---|
| **O1** | **Simplificación de predicados por análisis de rangos**: elimina filtros siempre verdaderos según el contrato, colapsa los siempre falsos y fusiona filtros | No (no conoce los rangos) | Usa los refinamientos `in [a,b]` y los `enum` |
| **O2** | **Eliminación de validaciones redundantes**: no genera chequeos de `expect`/contrato que ya están probados por los hechos | No | Los contratos solo existen en el DSL |
| **O3** | **Eliminación de joins por claves**: un join `many-to-one` con `references` cuyas columnas de la derecha no se usan después se elimina | No (no conoce las claves foráneas) | Usa `unique` + `references` |
| O4 | Column pruning + fusión de filtros | **Sí** | Es clásica; sirve como pase base y para la visualización de la IR |

**Recomendación:** O1 y O3 como las dos optimizaciones principales, con ganancia visible y
fuera del alcance de Polars. O2 sale casi gratis una vez existe el análisis de hechos. O4 se
implementa por completitud, pero en el reporte se declara que se solapa con Polars.

Para medir el aporte de forma aislada, cada pase se activa con un flag
(`--passes=O1,O3`, `-O0`), y se corre con el optimizador de Polars encendido y apagado.

---

## 6. Evaluación experimental (mapeo directo al enunciado)

**Datos:** **TPC-H** generado con DuckDB (`CALL dbgen(sf=…)`) a escalas 1, 5 y 10, exportado
a Parquet y CSV. Tiene claves y claves foráneas reales, ideal para O3. Se puede complementar
con un generador sintético con semilla para casos con nulos y rangos.

| Aspecto | Comparación | Métrica |
|---|---|---|
| Expresividad | DSL vs. Polars a mano **con las mismas validaciones** | LOC, tokens, nº de construcciones |
| Rendimiento | DSL `-O0` / DSL `-O*` / Polars manual idiomático | Tiempo (mediana + IQR), memoria pico |
| Impacto de optimizaciones | Cada pase solo y todos juntos; Polars opt on/off | Speedup relativo a `-O0` |
| Detección de errores | Corpus de N programas con errores de dominio (tabla §3) | % detectado en compilación vs. en Python |
| Usabilidad (opcional) | Tareas guiadas con compañeros | Tiempo, aciertos, encuesta SUS |

**Protocolo:** calentamiento + ≥ 10 corridas por configuración, mediana y dispersión, y
descripción del entorno (CPU, RAM, SO, versiones de Python y Polars). Todo se lanza con un
único script del repo.

---

## 7. Plan por fases

| Fase | Entregable |
|---|---|
| 0 | ✅ Dominio ETL aprobado por el docente (a nivel general; detallar la tesis §1 en la primera reunión) |
| 1 — MVP | Gramática EBNF, parser, AST, verificador de esquemas y tipos, codegen de `source/filter/select/derive/output`, pruebas |
| 2 | `join`, `group`, `expect`, nulabilidad, rangos, enums, claves; DAG en la IR |
| 3 | Pases O1–O4, benchmarks TPC-H, corpus de errores |
| 4 | Reporte LaTeX (acmart SIGPLAN, 6–10 págs.), documentación del lenguaje, exposición |
| Bonus | Entorno web (editor Monaco + backend FastAPI) con diagnósticos, AST, IR antes y después, código generado, ejecución y tabla o gráfico de resultados. Requiere las 3 reuniones |

---

## 8. Decisiones pendientes para el grupo

1. **Nombre y sintaxis final:** el operador `|>` frente a bloques secuenciales como en la propuesta original.
2. **Fuentes no confiables:** ¿se validan siempre los contratos de entrada en ejecución, o se ofrece un modo `--trust-sources`?
3. **Profundidad de los hechos:** solo rangos y nulabilidad, o también unicidad tras `group by` (la clave del grupo pasa a ser `unique`), que habilita más casos de O3.
4. **Bonus:** decidir pronto entre la app web y la extensión LSP, porque condiciona cómo se exponen el AST y la IR.
