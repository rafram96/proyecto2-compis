"""CSV, JSON y Markdown derivados exclusivamente de muestras válidas."""
from collections import defaultdict
import csv
import json
from pathlib import Path
from statistics import median


SAMPLE_FIELDS = ("sequence", "phase", "workload", "size", "seed", "configuration", "passes",
                 "scenario", "repetition", "unit", "value")
KEY_FIELDS = ("phase", "workload", "size", "seed", "configuration", "passes", "scenario")
SUMMARY_FIELDS = (*KEY_FIELDS, "unit", "n", "median", "p25", "p75", "iqr", "min", "max", "speedup_vs_O0")


def percentile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    lo = int(position)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (position - lo)


def summarize(samples):
    groups = defaultdict(list)
    for sample in samples:
        if sample["unit"] != "ms" or sample["value"] < 0:
            raise ValueError("Muestra inválida o unidad desconocida")
        groups[tuple(sample[k] for k in KEY_FIELDS)].append(sample["value"])
    rows = []
    for key, values in groups.items():
        p25, p75 = percentile(values, .25), percentile(values, .75)
        rows.append({**dict(zip(KEY_FIELDS, key)), "unit": "ms", "n": len(values),
                     "median": median(values), "p25": p25, "p75": p75, "iqr": p75 - p25,
                     "min": min(values), "max": max(values)})
    references = {(r["phase"], r["workload"], r["size"], r["scenario"]): r["median"]
                  for r in rows if r["configuration"] == "O0"}
    for row in rows:
        reference = references[(row["phase"], row["workload"], row["size"], row["scenario"])]
        row["speedup_vs_O0"] = reference / row["median"] if row["median"] else None
    return sorted(rows, key=lambda r: tuple(str(r[k]) for k in KEY_FIELDS))


def csv_file(path, rows, fields):
    with Path(path).open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def markdown(summary, structures, errors, metadata):
    env = metadata["environment"]
    lines = ["# Cauce C5: resultados medidos", "",
             f"Campaña **{metadata['mode']}** válida. Inicio UTC: {metadata['started_utc']}.",
             "Son mediciones de esta máquina; no son cifras de ejemplo ni evidencia de significancia estadística.", "",
             f"Python `{env['python'].split()[0]}`, Polars `{env['polars']}`, Lark `{env['lark']}`; "
             f"{env['cpu']}; {env['platform']}; {env['polars_threads']} hilos Polars.",
             f"Revisión base `{env['git_revision']}`; estado y hashes exactos del código en `metadata.json`.", "",
             f"Semilla {metadata['seed']}; tamaños {metadata['sizes']}; {metadata['warmups']} calentamientos "
             f"y {metadata['repetitions']} repeticiones por celda; orden barajado con la semilla.",
             "Datos en memoria generados de nuevo; dimensión derecha = max(2, min(10000, filas // 10)). "
             "Generación, comparación, carga del Python y exportación quedan fuera de los tiempos.", "",
             "Compilación: API pública analyze con artefacto python (scanner, parser, AST, validación, lowering, "
             "inferencia, pases y generación). size=0 significa independiente del dataset; no mide una entrada vacía. "
             "No hay tiempo de compilación para el baseline manual.", "",
             "Ejecución: nuevo runtime, invocación del pipeline o baseline y materialización de TODAS las salidas. "
             "Incluye contratos, snapshots y anti join C4; no mide únicamente collect(). "
             "El baseline manual conserva las mismas garantías mediante el runtime público, y el JOIN conserva ambas claves.", "",
             "`normal`: collect() habitual en salidas y validaciones, engine=auto. "
             "`final_flags_none`: QueryOptFlags.none() solo en los collect finales, engine=auto; "
             "validaciones/snapshots/anti join internos mantienen opciones habituales. No es Polars sin optimización; "
             "type_check/type_coercion permanecen según los flags registrados en metadata.json.", "",
             f"Equivalencia previa: {len(metadata['equivalence'])} comprobaciones (más cada ejecución cronometrada). "
             f"Corpus separado: {len(errors)} errores esperados conservados. "
             "Se verifican puertos, columnas y orden, dtypes, forma, nulos y valores exactos, incluidos NULL/NaN. "
             "Orden de filas conservado salvo control_sin_garantia: allí se ordenan todas las columnas "
             "lexicográficamente sin eliminar multiplicidad. Casos: vacíos, límites, todos NULL y duplicados.", "",
             "## Tiempos", "",
             "Mediana e IQR en **ms**; IQR = P75 − P25 con interpolación lineal. "
             "Razón = mediana O0 / mediana de la configuración para igual workload, tamaño, fase y escenario. "
             "Mayor que 1 indica menos tiempo; menor que 1, regresión observada. No compara compilación con ejecución.", "",
             "| Fase | Workload | Filas | Motor | Configuración | Mediana ms | IQR ms | O0/config |",
             "|---|---|---:|---|---|---:|---:|---:|"]
    for row in summary:
        ratio = row["speedup_vs_O0"]
        ratio_text = f"{ratio:.3f}" if ratio is not None else "n/a"
        lines.append(f"| {row['phase']} | {row['workload']} | {row['size']} | {row['scenario']} | "
                     f"{row['configuration']} | {row['median']:.4f} | {row['iqr']:.4f} | {ratio_text} |")
    lines += ["", "## Evidencia estructural (fuera del tiempo)", "",
              "`changed` compara nodos/payload/enlaces; añadir hechos a la IR no cuenta como reescritura. "
              "rangos y joins conservan sus pruebas completas en structure.json. Los otros pases muestran "
              "nodos eliminados/modificados/fusionados; las abstenciones se comprueban al ejecutar el arnés.", "",
              "| Workload | Configuración | Nodos antes/después | Cambia | Pruebas rangos/joins |",
              "|---|---|---:|---|---:|"]
    for row in structures:
        lines.append(f"| {row['workload']} | {row['configuration']} | {row['nodes_before']}/{row['nodes_after']} | "
                     f"{row['changed']} | {row['range_rewrites']}/{row['join_rewrites']} |")
    lines += ["", "## Expresividad y errores", "",
              "LOC = líneas no vacías y no comentadas en los archivos reales, sin normalizar formato. "
              "La función Polars utiliza helpers compartidos y contratos del runtime: se indica su coste común "
              "por separado; las declaraciones de esquemas están en baselines.py. No se infiere legibilidad ni "
              "usabilidad a partir de LOC. El número de nodos cuenta construcciones de la IR original.", "",
              "| Workload | LOC DSL | LOC función Polars | LOC helpers compartidos | Nodos |",
              "|---|---:|---:|---:|---:|"]
    for row in metadata["expressivity"]:
        lines.append(f"| {row['workload']} | {row['dsl_nonblank_noncomment_lines']} | {row['manual_function_lines']} | "
                     f"{row['manual_shared_helper_lines']} | {row['dsl_nodes']} |")
    lines += ["", "errors.csv contiene el corpus estático (columna ausente, predicado numérico y claves "
              "con tipos incompatibles) y sus controles Polars reales, que fallan al materializar. "
              "El corpus dinámico exige errores de claves, unicidad, referencia y contratos de ambas entradas "
              "a O0, a cada pase, al conjunto y al baseline contractual. No se cronometran fallos.", "",
              "## Límites y reproducción", "",
              "No se mide IO, memoria pico, arranque de intérprete, otras máquinas ni significancia. "
              "Se reutilizan buffers residentes pero se reconstruyen planes y resultados en cada invocación. "
              "No se vacían cachés CPU/SO; GC y planificación del sistema siguen activos. Ocho workloads "
              "sintéticos y una semilla no representan todos los ETL. Las optimizaciones habituales del motor "
              "pueden absorber el efecto de los pases; reducir nodos no garantiza reducir tiempo. "
              "El baseline comparte la implementación de contratos y puede compartir sus defectos: la suite "
              "del runtime aporta regresiones independientes. Los grupos suman valores enteros representados "
              "como Float64 para evitar ambigüedad por redondeo paralelo; no se evalúa toda aritmética decimal.", "",
              "Comando equivalente desde la raíz (requiere requirements.txt; elegir un directorio nuevo):", "", "```sh",
              ".venv/bin/python -m benchmarks "
              f"--mode {metadata['mode']} --sizes {','.join(map(str, metadata['sizes']))} "
              f"--seed {metadata['seed']} --threads {env['polars_threads']} "
              f"--warmups {metadata['warmups']} --repetitions {metadata['repetitions']} "
              f"--scenarios {','.join(metadata['scenarios'])} --output benchmarks/results/reproduccion",
              "```", "",
              "samples.csv permite recalcular los resúmenes. summary.csv, structure.csv/json, errors.csv "
              "y metadata.json permiten auditar la campaña; estos artefactos generados no se versionan.", ""]
    return "\n".join(lines)


def export(directory, samples, structures, errors, metadata):
    summary = summarize(samples)
    csv_file(directory / "samples.csv", samples, SAMPLE_FIELDS)
    csv_file(directory / "summary.csv", summary, SUMMARY_FIELDS)
    csv_file(directory / "structure.csv", [{**r, "passes": ",".join(r["passes"]),
        "removed": ",".join(r["removed"]), "added": ",".join(r["added"]), "modified": ",".join(r["modified"])} for r in structures],
        ("workload", "configuration", "passes", "nodes_before", "nodes_after", "changed", "removed", "added",
         "modified", "range_rewrites", "join_rewrites"))
    csv_file(directory / "errors.csv", errors, ("phase", "workload", "case", "configuration", "expected", "observed", "plain_polars"))
    for filename, value in (("metadata.json", metadata), ("structure.json", structures)):
        (directory / filename).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    (directory / "report.md").write_text(markdown(summary, structures, errors, metadata), encoding="utf-8")
