# Evaluación C5

Desde la raíz del checkout, con las dependencias de `requirements.txt`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m pip install -e . --no-deps
.venv/bin/python -m benchmarks --mode small --output benchmarks/results/comprobacion
.venv/bin/python -m benchmarks --mode measure --output benchmarks/results/medicion
```

Cada comando genera datos en memoria, comprueba equivalencia, verifica contratos,
mide y exporta el reporte. El destino debe ser nuevo; sin `--output` se crea un
directorio con timestamp. `small` es el modo predeterminado: 64 filas, un
calentamiento y dos repeticiones. `measure`: 10 000 y 200 000 filas, dos
calentamientos y diez repeticiones. No se añaden dependencias al compilador.

Opciones: `--sizes 10000,200000,1000000`, `--seed 20261111`, `--threads 4`,
`--warmups 2`, `--repetitions 10`, `--scenarios normal,final_flags_none`.
El proceso fija `POLARS_MAX_THREADS` antes de importar Polars y verifica el pool
efectivo. Para usar `run()` desde Python, inicialice esa variable antes de
importar el arnés. La reproducción de los dos escenarios usa Polars 2.1.0
fijado en requirements; versiones sin QueryOptFlags admiten `--scenarios normal`.

Los ocho programas están en [programs/](programs/); los baselines contractuales
manuales en [baselines.py](baselines.py). Hay tablas de tiempos, evidencia IR,
expresividad descriptiva y corpus de errores. Los CSV/JSON/Markdown generados
quedan en `results/`, ignorado por Git, al igual que cualquier dataset de `data/`.
No es necesario almacenar datasets para reproducirlos.

Excepción explícita: la campaña `representativa` se publica en una instantánea versionada,
`web/public/evidencia/c5-representativa/`, mediante `web/scripts/gen_evaluation.py --import-campaign`.
`evidence.py` valida esquemas, celdas, recálculos con `report.summarize` y referencias cruzadas,
y depura únicamente la ruta local del intérprete en `metadata.public.json`. Véase la
[publicación de la evidencia](../docs/evaluacion.md#publicación-de-la-evidencia-y-página-evaluacion-paso-e).

Metodología, interpretación de las razones, control parcial de Polars,
resultados medidos y límites: [docs/evaluacion.md](../docs/evaluacion.md).
