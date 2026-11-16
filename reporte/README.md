# Reporte

La segunda versión se encuentra en **`main_v2.tex` / `main_v2.pdf`**, con el nombre
del lenguaje **Capybara** y los cuatro integrantes del grupo. `main.tex` y `main.pdf`
conservan la primera versión.

La versión 2 sigue las indicaciones de las páginas 14–15 del enunciado: plantilla ACM
SIGPLAN, artículo de 6–10 páginas de contenido, referencias, apéndices y declaración
de uso de IA. La gramática y los ejemplos se incluyen como apéndices.
El PDF compilado tiene **10 páginas de contenido, 1 de referencias y 2 de apéndices**.

Incluye la sección **Usabilidad para LLMs**, con las tres corridas de Junie,
la comparación Capybara/Polars antes y después del refuerzo del prompt y las
limitaciones del experimento. No se presenta como un estudio con usuarios humanos.

Para regenerar sus ocho gráficos y seis tablas, desde la raíz del proyecto:

```bash
python reporte/graficos_v2.py
python reporte/llm_v2.py
cd reporte
latexmk -pdf main_v2.tex
```

También puede compilarse con `tectonic main_v2.tex` desde `reporte/`, o con el
contenedor TeX Live indicado abajo, sustituyendo `main.tex` por `main_v2.tex`.
Las dependencias del análisis son `matplotlib`, `numpy` y `pandas`.

Las figuras de `generado_v2/figuras/` incluyen PDF vectorial para el artículo y PNG
para revisión. Se generan desde los CSV de `bench/resultados/` y reutilizan la
selección de corridas, las medianas y los cuartiles de `bench/analisis.py`. Las
comparaciones relativas muestran el cociente de medianas.
`generado_v2/procedencia.txt` registra las corridas utilizadas.
No se cambian las mediciones ni los recursos del reporte original.

`llm_v2.py` usa los JSON de las tres corridas locales en `bench-LLM/resultados/`.
Los hashes de los archivos utilizados se registran en `generado_v2/procedencia_llm.json`;
la tabla, las cifras y el gráfico se generan automáticamente. Las evaluaciones,
respuestas y manifiestos de las tres corridas citadas están versionados. Los logs
completos de Junie en `raw/` y las pruebas preliminares permanecen fuera de Git.

Artículo en formato ACM SIGPLAN (`acmart`). Las tablas, figuras y cifras de la evaluación
están en `generado/` y salen de `bench/analisis.py`; no se editan a mano.

```bash
# 1. Regenerar tablas y figuras (desde la raíz del repositorio)
docker compose run --rm bench sh -c "python bench/errores.py && python bench/expresividad.py && python bench/analisis.py"

# 2. Compilar el PDF con TeX Live (desde la raíz del repositorio)
docker run --rm -v "$PWD:/doc" -w /doc/reporte texlive/texlive:latest latexmk -pdf main.tex
```

En PowerShell, reemplazar `$PWD` por `${PWD}`. Con una instalación local de LaTeX basta
`latexmk -pdf main.tex` dentro de `reporte/`. El resultado es `reporte/main.pdf`.
