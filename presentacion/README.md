# Presentación de CaPybara

La versión actual tiene **17 diapositivas** y está en [v2_17/](v2_17/README.md):
incluye los tres artículos de inspiración, los ocho gráficos del reporte,
storytelling ampliado y la síntesis de tres fortalezas.
[Abrir la versión de 17 diapositivas en Canva](https://www.canva.com/d/ITyUDAJL672z0d_).

La documentación que sigue corresponde a la primera versión de siete diapositivas.

Versión de **siete diapositivas**, creada y corregida con el MCP de Canva,
revisada visualmente y guardada después de la aprobación explícita del usuario.

- [Editar en Canva](https://www.canva.com/d/aJ0astL8QnJKXpg)
- [Ver en Canva](https://www.canva.com/d/SqVVY4fhEoDkUy_)
- [PDF exportado desde Canva](CaPybara_Canva.pdf)
- [PowerPoint exportado desde Canva](CaPybara_Canva.pptx)
- [Guion y notas para exponer](guion.md)

La historia presenta el problema de preparar un resumen de ventas, revela CaPybara,
muestra un programa pequeño y explica el compilador, la evaluación de rendimiento,
la generación con LLMs y los desafíos pendientes. El logo proviene de
`docs/img/capybara.png`; los autores completos aparecen en el cierre.

Los veinte minutos de la apertura son un **escenario ilustrativo**, no una medición
de tiempo de desarrollo ni un ahorro demostrado. Las cifras de rendimiento,
expresividad y detección de errores proceden de `reporte/generado_v2/tablas/`.
La exploración con LLMs usa las corridas `junie-20261115-polars` y
`junie-20261115-polars-punto-coma` de `bench-LLM/resultados/`. Se muestran sus límites.

El ejemplo [ventas.etl](ventas.etl) se ejecutó con el compilador y runtime del proyecto:
produce Ana = 150 y Luis = 80; una variante con `mnto` produce `E_COLUMN`.
[verificacion.json](verificacion.json) conserva ese resultado. Las dos exportaciones
de Canva se comprobaron: siete páginas PDF y siete diapositivas PowerPoint.

`contenido.json` y `guion.md` contienen el contenido y sus fuentes.
`vista_previa_canva.pdf` conserva la revisión del borrador obtenida con el MCP.
`CaPybara.pdf`, `CaPybara.pptx` y `generar.py` corresponden a una propuesta local
anterior con el mismo guion; las versiones finales son **CaPybara_Canva** y el diseño
enlazado arriba. Los enlaces y el ID del diseño guardado están en `canva.json`.
