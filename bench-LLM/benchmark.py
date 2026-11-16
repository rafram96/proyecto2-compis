"""Preparación y evaluación local de los casos de Anka con Capybara y Python.

No realiza llamadas a un LLM. Las respuestas se reciben como JSONL.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TASKS = HERE / "upstream" / "benchmarks" / "tasks"
LANGUAGES = ("capybara", "python", "polars")
# Clasificación previa a observar respuestas de modelos. No se reescriben tareas.
UNSUPPORTED = {
    "filter_008": "CONTAINS no está implementado.",
    "fin_015": "LIMIT y expresiones con conteo de filas fuera de AGGREGATE.",
    "fin_018": "STARTS_WITH y LIMIT no están implementados.",
    "hard_002": "STARTS_WITH para filtrar fechas no está implementado.",
    "hard_003": "Extracción/comparación del año de una fecha no implementada.",
    "map_004": "Expresiones condicionales IF no implementadas.",
    "map_006": "TO_STRING no está implementado.",
    "map_007": "ROUND no está implementado.",
    "map_008": "Concatenación de cadenas no implementada.",
    "map_009": "PARSE_DATE y DIFF_DAYS no implementados.",
    "map_010": "IF y ROUND no implementados.",
    "multi_008": "UNION no está implementado.",
    "multi_009": "LIMIT no está implementado.",
    "str_004": "Concatenación de cadenas no implementada.",
    "str_005": "LENGTH no está implementado.",
    "str_006": "SUBSTRING no está implementado.",
    "str_007": "REPLACE no está implementado.",
    "str_008": "CONTAINS no está implementado.",
    "str_009": "STARTS_WITH no está implementado.",
    "str_010": "Extracción mediante SPLIT/SUBSTRING no implementada.",
}


def dump(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def load_tasks():
    tasks = {}
    for path in sorted(TASKS.rglob("*.json")):
        task = json.loads(path.read_text(encoding="utf-8"))
        if task["id"] in tasks or not re.fullmatch(r"[A-Za-z0-9_]+", task["id"]):
            raise ValueError(f"ID duplicado o inválido: {task['id']}")
        if not task["test_cases"]:
            raise ValueError(f"Tarea sin tests: {path}")
        for case in task["test_cases"]:
            expected(case)
        tasks[task["id"]] = task
    return tasks


def expected(case):
    # No usar `a or b`: una salida esperada [] es un caso válido.
    return case["expected"] if "expected" in case else case["expected_output"]


def columns(definition):
    if isinstance(definition, list):
        return [(c["name"], c["type"]) for c in definition]
    return list(zip(definition["columns"], definition["types"], strict=True))


def schema_text(task):
    lines = []
    for table, definition in task["input_schema"].items():
        # El corpus no declara nulabilidad de forma uniforme: se admiten nulos
        # conservadoramente en todos los campos, sin consultar las salidas esperadas.
        fields = ", ".join(f"{name}: {kind.rstrip('?')}?" for name, kind in columns(definition))
        lines.append(f'- {table}: TABLE[{fields}], file: "input/{table}.parquet"')
    return "\n".join(lines)


def prompt(task, language):
    template = (HERE / "prompts" / f"{language}.md").read_text(encoding="utf-8")
    return template.replace("{task}", task.get("prompt") or task["description"]).replace("{schema}", schema_text(task))


def verify_upstream():
    manifest = json.loads((HERE / "UPSTREAM.json").read_text(encoding="utf-8"))
    for relative, digest in manifest["sha256"].items():
        path = HERE / "upstream" / relative
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Copia original modificada: {relative}")
    return manifest


def prepare(output, categories=None, ids=None, include_unsupported=False, baseline="polars"):
    upstream = verify_upstream()
    tasks = load_tasks()
    selected, excluded, entries = [], [], []
    languages = ("capybara", baseline)
    for task in tasks.values():
        if categories and task["category"] not in categories:
            continue
        if ids and task["id"] not in ids:
            continue
        reason = UNSUPPORTED.get(task["id"])
        if reason and not include_unsupported:
            excluded.append({"task_id": task["id"], "category": task["category"], "reason": reason})
            continue
        selected.append({"task_id": task["id"], "category": task["category"],
                         "test_cases": len(task["test_cases"]), "compatibility": reason or "Sin incompatibilidad conocida"})
        for language in languages:
            text = prompt(task, language)
            destination = output / "prompts" / language / f"{task['id']}.md"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(text, encoding="utf-8")
            entries.append({"task_id": task["id"], "language": language, "prompt": text,
                            "prompt_sha256": hashlib.sha256(text.encode()).hexdigest()})
    if not selected:
        raise ValueError("No hay tareas seleccionadas; revisar filtros y compatibilidad.")
    manifest = {"upstream_commit": upstream["commit"], "created_at": datetime.now(timezone.utc).isoformat(),
                "selected": selected, "excluded": excluded, "corpus_total": len(tasks),
                "include_unsupported": include_unsupported,
                "languages": list(languages), "baseline": baseline,
                "templates_sha256": {lang: hashlib.sha256((HERE / 'prompts' / f'{lang}.md').read_bytes()).hexdigest() for lang in languages}}
    dump(output / "manifest.json", manifest)
    (output / "prompts.jsonl").write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in entries), encoding="utf-8")
    print(f"{len(selected)} tareas seleccionadas; {len(excluded)} excluidas; {len(entries)} prompts en {output}")
    return manifest


def export_generation(prepared, destination, language):
    """Exporta solo prompts de un lenguaje, sin código del evaluador ni tests."""
    source = prepared / "prompts.jsonl"
    requests = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row["language"] != language:
            continue
        text = row["prompt"]
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if digest != row["prompt_sha256"]:
            raise ValueError(f"Prompt modificado: {row['task_id']}")
        # Lista explícita: no se exportan campos extra del archivo de origen.
        requests.append({"task_id": row["task_id"], "language": language,
                         "prompt": text, "prompt_sha256": digest})
    if not requests:
        raise ValueError(f"No hay prompts para {language} en {prepared}.")
    instructions = '''# Generación de respuestas para un benchmark

solicitudes.jsonl contiene una solicitud por línea. Cada solicitud es un experimento
independiente: abrir una sesión nueva, sin historial, por tarea y por muestra.
Enviar al modelo solamente el campo "prompt" de esa solicitud.

Guardar la respuesta original antes de corregir o ejecutar su código. No hacer
búsquedas, leer otros archivos, usar soluciones previas ni pedir feedback al evaluador.
La prueba mide generación a partir del prompt, sin herramientas ni autorreparación.
Los ejemplos didácticos de sintaxis ya están incluidos en el prompt de cada tarea.

Por cada respuesta, escribir una línea JSON en respuestas.jsonl con:
{"task_id":"...","language":"...","sample":1,"model":"identificador-exacto",
 "prompt_sha256":"hash-de-la-solicitud","code":"respuesta-original-del-modelo"}

Usar el task_id, language y hash de la solicitud. Si se hacen varias muestras,
numerarlas desde 1 y usar el mismo número para los dos lenguajes comparados.
Registrar modelo, fecha, temperatura y límite de generación en notas-corrida.txt.
Entregar respuestas.jsonl y notas-corrida.txt al responsable de la evaluación.

Este paquete contiene datos de generación; no incluye evaluador ni tests.
El ZIP no impone aislamiento: usarlo en una sesión sin herramientas de archivos,
o en una máquina/contenedor que solo tenga acceso a este paquete. Cambiar de
directorio de trabajo no impide leer otras carpetas mediante rutas absolutas.
'''
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError(f"El paquete ya existe; usar otra ruta para conservarlo: {destination}")
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("LEEME.md", instructions)
        archive.writestr("solicitudes.jsonl", "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in requests))
    print(f"{len(requests)} prompts de {language}, sin tests ni evaluador: {destination}")
    return requests


def compare(actual, wanted):
    """Orden de filas y columnas exactas; tolerancia absoluta numérica 1e-9."""
    if isinstance(wanted, bool) or wanted is None:
        return type(actual) is type(wanted) and actual == wanted
    if isinstance(wanted, (int, float)):
        return (isinstance(actual, (int, float)) and not isinstance(actual, bool)
                and math.isfinite(actual) and math.isfinite(wanted)
                and math.isclose(actual, wanted, rel_tol=0, abs_tol=1e-9))
    if isinstance(wanted, dict):
        return isinstance(actual, dict) and actual.keys() == wanted.keys() and all(compare(actual[k], v) for k, v in wanted.items())
    if isinstance(wanted, list):
        return isinstance(actual, list) and len(actual) == len(wanted) and all(compare(a, b) for a, b in zip(actual, wanted))
    return type(actual) is type(wanted) and actual == wanted


def extract_code(text):
    match = re.search(r"```[^\n]*\n(.*?)```", text, re.DOTALL)
    return match.group(1).strip() if match else text.strip()


def execute(task, code, language, timeout=10):
    payload = {"task": task, "code": extract_code(code), "language": language}
    start = time.perf_counter()
    try:
        with tempfile.TemporaryDirectory(prefix="capybara-llm-") as temporary:
            job = Path(temporary) / "job.json"
            result = Path(temporary) / "result.json"
            dump(job, payload)
            process = subprocess.run([sys.executable, str(HERE / "worker.py"), str(job), str(result)],
                                     cwd=temporary, capture_output=True, text=True, encoding="utf-8",
                                     errors="replace", timeout=timeout)
            if process.returncode != 0 or not result.exists():
                return {"status": "worker_error", "error": process.stderr[-3000:], "pass_all": False}
            value = json.loads(result.read_text(encoding="utf-8"))
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "pass_all": False, "error": f"Límite de {timeout:g} s por programa."}
    value["execution_ms"] = round((time.perf_counter() - start) * 1000, 3)
    return value


def evaluate(responses, output, manifest_path, timeout):
    upstream = verify_upstream()
    tasks = load_tasks()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["upstream_commit"] != upstream["commit"]:
        raise ValueError("El manifiesto corresponde a otra versión del corpus original.")
    selected = {entry["task_id"] for entry in manifest["selected"]}
    languages = manifest.get("languages", ["capybara", "python"])
    results, seen, rows = [], set(), []
    for number, line in enumerate(responses.read_text(encoding="utf-8-sig").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        task_id, language = row["task_id"], row["language"]
        sample = row.get("sample", 1)
        if task_id not in selected or task_id not in tasks or language not in languages or not isinstance(row["code"], str):
            raise ValueError(f"Respuesta inválida en línea {number}: tarea, lenguaje o código.")
        if type(sample) is not int or sample < 1:
            raise ValueError(f"Muestra inválida en línea {number}.")
        key = (task_id, language, sample)
        if key in seen:
            raise ValueError(f"Respuesta duplicada: {key}")
        seen.add(key)
        rows.append({**row, "sample": sample})
    if not rows:
        raise ValueError("El archivo de respuestas está vacío.")
    for row in rows:
        if row.get("generation_error"):
            value = {"status": "generation_error", "syntax_ok": False, "pass_all": False,
                     "error": row["generation_error"]}
        else:
            value = execute(tasks[row["task_id"]], row["code"], row["language"], timeout)
        results.append({**row, "category": tasks[row["task_id"]]["category"], **value})
        print(row["task_id"], row["language"], value["status"])
    groups = defaultdict(list)
    for row in results:
        groups[row["language"]].append(row)
    summary = {}
    for language, values in groups.items():
        attempted = {v["task_id"] for v in values}
        summary[language] = {"samples": len(values), "tasks_attempted": len(attempted),
                             "selected_tasks": len(selected), "missing_tasks": sorted(selected - attempted),
                             "syntax_success_samples": sum(v.get("syntax_ok", False) for v in values),
                             "correct_samples": sum(v["pass_all"] for v in values),
                             "accuracy_on_submitted_samples": sum(v["pass_all"] for v in values) / len(values),
                             "status_counts": dict(Counter(v["status"] for v in values)),
                             "samples_per_task": dict(Counter(v["task_id"] for v in values))}
    pair_sets = [{(r['task_id'], r['sample']) for r in results if r['language'] == lang} for lang in languages]
    paired = bool(pair_sets[0]) and all(pairs == pair_sets[0] for pairs in pair_sets)
    dump(output, {"kind": "evaluation_of_saved_responses", "manifest": manifest,
                  "responses_sha256": hashlib.sha256(responses.read_bytes()).hexdigest(),
                  "created_at": datetime.now(timezone.utc).isoformat(),
                  "paired_samples": paired, "summary": summary, "results": results})
    print(f"Resultados: {output}. Muestras emparejadas: {paired}")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_cmd = sub.add_parser("preparar", help="Exporta prompts, cobertura y exclusiones.")
    prepare_cmd.add_argument("--salida", type=Path, default=HERE / "preparado")
    prepare_cmd.add_argument("--categorias", nargs="+")
    prepare_cmd.add_argument("--tareas", nargs="+")
    prepare_cmd.add_argument("--incluir-no-soportadas", action="store_true")
    prepare_cmd.add_argument("--baseline", choices=("python", "polars"), default="polars",
                             help="Comparación: Polars por defecto; python conserva el protocolo anterior.")
    export_cmd = sub.add_parser("exportar", help="Crea un ZIP de generación sin proyecto ni tests.")
    export_cmd.add_argument("--preparado", type=Path, default=HERE / "preparado")
    export_cmd.add_argument("--lenguaje", choices=LANGUAGES, required=True)
    export_cmd.add_argument("--salida", type=Path, required=True)
    evaluate_cmd = sub.add_parser("evaluar", help="Ejecuta y compara respuestas JSONL guardadas.")
    evaluate_cmd.add_argument("respuestas", type=Path)
    evaluate_cmd.add_argument("--manifiesto", type=Path, default=HERE / "preparado" / "manifest.json")
    evaluate_cmd.add_argument("--salida", type=Path, default=HERE / "resultados" / "evaluacion.json")
    evaluate_cmd.add_argument("--timeout", type=float, default=10)
    args = parser.parse_args()
    try:
        if args.command == "preparar":
            tasks = load_tasks()
            unknown = set(args.tareas or []) - tasks.keys()
            if unknown:
                raise ValueError(f"Tareas desconocidas: {sorted(unknown)}")
            prepare(args.salida, args.categorias, args.tareas, args.incluir_no_soportadas, args.baseline)
        elif args.command == "exportar":
            export_generation(args.preparado, args.salida, args.lenguaje)
        else:
            if args.timeout <= 0:
                raise ValueError("El timeout debe ser positivo.")
            evaluate(args.respuestas, args.salida, args.manifiesto, args.timeout)
    except (ValueError, KeyError, OSError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
