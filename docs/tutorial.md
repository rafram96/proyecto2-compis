# De un CSV a un resultado

En este recorrido conviertes un archivo CSV de pedidos en una tabla que dice cuánto gastó cada cliente. Escribirás un programa corto, provocarás un error a propósito para aprender a leerlo, lo compilarás y lo ejecutarás hasta obtener un archivo nuevo. No necesitas saber programar en Python.

El programa completo es [demo/tutorial.etl](../demo/tutorial.etl). Los fragmentos de esta guía son partes de ese archivo; en la web, la versión completa aparece al final de la página.

## 1. El CSV de partida

Usaremos `demo/joins_pedidos.csv`, que viene incluido en el proyecto. Tiene un pedido por fila: el número de cliente y el importe.

```csv
cliente,importe
2,30
1,10
2,40
```

Este archivo **no requiere preparación**: no hace falta ejecutar `scripts/create_demo_data.py` ni `python -m service.prepare`. En el servicio de ejecución aparece como el dataset `join-orders@1` («JOIN · pedidos»). Otros ejemplos sí la necesitan: `orders.csv` se crea con `python scripts/create_demo_data.py` para la terminal y con `python -m service.prepare` para el servicio.

## 2. Declarar la fuente con su contrato

Un programa es un `PIPELINE` con un nombre. Dentro, `SOURCE` indica de dónde salen los datos y qué forma deben tener:

```text
    SOURCE pedidos: TABLE[cliente: INT, importe: DECIMAL]
        = CSV(file: "joins_pedidos.csv");
```

La parte `TABLE[...]` es el **contrato**: el archivo debe tener exactamente las columnas `cliente` e `importe`, en ese orden. `INT` admite enteros; `DECIMAL` admite cualquier número, con o sin decimales. Como ninguna columna lleva `?`, ninguna puede tener valores vacíos. La ruta del archivo se busca en la misma carpeta que el programa.

El contrato sirve dos veces. Al compilar, el análisis ya conoce las columnas y detecta nombres mal escritos sin abrir el archivo. Al ejecutar, se comprueba contra los datos reales.

## 3. Filtrar, derivar y agregar

Cada paso es un `STEP` con una operación. Primero se descartan los importes que no sean positivos:

```text
    STEP validos = FILTER {
        WHERE importe > 0;
    }
```

Después se añade una columna nueva calculada a partir de otra; aquí, el importe con IGV:

```text
    STEP con_igv = DERIVE {
        importe_con_igv = importe * 1.18;
    }
```

`AGGREGATE` deja una fila por cliente, con la cantidad de pedidos y las sumas. `SORT` pone primero a quien más gastó:

```text
    STEP por_cliente = AGGREGATE {
        GROUP_BY cliente;
        COUNT() AS pedidos;
        SUM(importe) AS total;
        SUM(importe_con_igv) AS total_con_igv;
    }
```

```text
    STEP ranking = SORT {
        BY total DESC;
    }
```

Por último, `SINK` dice dónde guardar el resultado y `FLOW` conecta todo en orden. Sin `FLOW`, los pasos existen pero no reciben datos:

```text
    SINK reporte = CSV(file: "out/gasto_por_cliente.csv");

    FLOW {
        pedidos -> validos -> con_igv -> por_cliente -> ranking -> reporte;
    }
```

## 4. Provocar y corregir un error

Cambia `importe` por `importes` en el filtro, como si fuera un error de escritura:

```text
        WHERE importes > 0;
```

En el estudio, al compilar aparece el diagnóstico `E_COLUMN` con el mensaje «Columna inexistente: importes.». Púlsalo: el editor selecciona exactamente `importes`, en la línea 10, columna 15. Corrige la palabra y vuelve a compilar; el diagnóstico desaparece.

En la terminal ocurre lo mismo. Desde la carpeta del proyecto, con el entorno activado (macOS/Linux: `source .venv/bin/activate`; Windows: `.venv\Scripts\activate`):

```sh
python main.py demo/tutorial.etl --format check
```

```output
demo/tutorial.etl:10:15: E_COLUMN: Columna inexistente: importes.
        WHERE importes > 0;
              ^
demo/tutorial.etl: 1 error(es) de validación.
```

El error se detecta **antes de leer datos**, porque el contrato de `SOURCE` dice qué columnas existen. Sin contrato, el mismo error aparecería recién al ejecutar. Vuelve a escribir `importe` antes de seguir.

## 5. Compilar e inspeccionar

**En el estudio.** Abre el ejemplo [Gasto por cliente desde un CSV](/ejemplos/gasto-por-cliente) y pulsa «Abrir una copia en el estudio». Tu documento anterior queda en Borradores anteriores. Pulsa Compilar o Ctrl/⌘ + Enter; la primera vez se descarga Python en el navegador y tarda un poco más. Compilar no lee el CSV.

Con el programa compilado, revisa las vistas del inspector: FLOW dibuja la cadena de pasos, Esquemas muestra las columnas y tipos que el análisis conoce en cada paso, IR enseña el programa antes y después de las optimizaciones, y Python, el código generado. Estos accesos abren esas vistas del documento que tengas activo, no necesariamente este programa: [FLOW](/estudio?vista=flow), [Esquemas](/estudio?vista=esquemas), [IR](/estudio?vista=ir) y [Python](/estudio?vista=python).

**En la terminal.**

```sh
python main.py demo/tutorial.etl --format check
```

```output
OK: demo/tutorial.etl: 1 pipeline(s); sintaxis y estructura válidas.
```

`python main.py demo/tutorial.etl --format ir` muestra la IR antes y después de los cinco pases predeterminados. En este programa no hay nada que simplificar, así que ambas versiones son iguales; `-O0` desactiva los pases.

## 6. Ejecutar

**Desde el estudio.** Ejecutar requiere el servicio privado de Cauce en marcha; cómo iniciarlo está en la [guía del servicio de ejecución](servicio_ejecucion.md). Para este programa no hace falta prepararlo con datos adicionales. Ve a la vista [Resultados](/estudio?vista=ejecucion) y elige el pipeline `gasto_por_cliente`. En `gasto_por_cliente.pedidos` elige «JOIN · pedidos · join-orders@1» y pulsa Ejecutar. Si el estudio avisa de que hay datasets sin preparar, ese aviso se refiere a otros ejemplos: este dataset está disponible igualmente. El trabajo pasa por En cola y Ejecutando hasta Completado. El servicio vuelve a compilar el programa y lo ejecuta con Polars sobre una copia del dataset autorizado.

**Desde la terminal.**

```sh
python main.py demo/tutorial.etl --run
```

```output
OK: demo/tutorial.etl -> output/tutorial.py
POLARS: PIPELINE gasto_por_cliente ejecutado.
SINK: …/demo/out/gasto_por_cliente.csv
```

La última línea muestra la ruta completa de tu equipo; aquí se abrevia con «…». El Python generado puede ejecutarse de nuevo sin volver a compilar, con el proyecto instalado:

```sh
python output/tutorial.py
```

```output
POLARS: PIPELINE gasto_por_cliente ejecutado.
SINK: …/demo/out/gasto_por_cliente.csv
```

## 7. El archivo de salida

En el estudio, Completado muestra la tabla con dos filas y el botón «Descargar gasto_por_cliente.csv». En la terminal, el archivo queda en `demo/out/gasto_por_cliente.csv`. En ambos casos el contenido es el mismo:

```csv
cliente,pedidos,total,total_con_igv
2,2,70,82.60
1,1,10,11.80
```

El cliente 2 tiene dos pedidos (30 + 40 = 70) y el cliente 1, uno. `total_con_igv` conserva exactamente dos decimales porque `1.18` se trata como decimal exacto, no como número aproximado. Si vuelves a ejecutar, el archivo se reemplaza. En el estudio, la descarga caduca en el servidor a los 60 minutos.

## Qué sigue

- [Tu primer programa](/docs/primer-programa) explica cómo conservar y recuperar tus documentos en el estudio.
- [Operaciones y expresiones](/docs/operaciones) describe las diez operaciones y las funciones disponibles.
- [NULL, contratos y diagnósticos](/docs/null-contratos) explica columnas con `?`, valores vacíos y otros errores.
- [Conectores y compilación local](/docs/conectores) detalla las opciones de CSV, Parquet, SQLite y DuckDB.
