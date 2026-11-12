"""Publicación auditable de una campaña C5 ya medida.

Solo usa la biblioteca estándar y las reglas de ``benchmarks.report``: no importa
Polars ni el arnés, no mide y no reescribe cifras. Valida una campaña (original o
instantánea pública), depura metadatos con reglas explícitas y produce los datos
deterministas que consume ``/evaluacion``.
"""
from collections import Counter, defaultdict
import csv
from hashlib import sha256
import io
import json
import math
from pathlib import Path

from .report import KEY_FIELDS, SAMPLE_FIELDS, SUMMARY_FIELDS, summarize

STRUCTURE_FIELDS = ("workload", "configuration", "passes", "nodes_before", "nodes_after", "changed",
                    "removed", "added", "modified", "range_rewrites", "join_rewrites")
ERROR_FIELDS = ("phase", "workload", "case", "configuration", "expected", "observed", "plain_polars")
PHASES = {"compile": "not_applicable", "execute": None}
MANUAL = "manual"
REDACTED = "[redactado en la publicación: ruta local del intérprete]"
# Única depuración admitida: campos con rutas o datos del equipo sin valor científico.
REDACTIONS = (("environment", "python_executable",
               "Ruta absoluta del host con el usuario local; la versión de Python se conserva en environment.python."),)


class EvidenceError(ValueError):
    """La evidencia es incompleta o incompatible; nunca se completa en silencio."""


# Misma regla que benchmarks.harness.environment(): qué fuentes registra una campaña
# en environment.source_sha256. Se replica aquí porque modificar el arnés cambiaría
# su propio hash; tests/test_evaluation_evidence.py comprueba que ambas coinciden.
SOURCE_GROUPS = (
    ("compiler", "Compilador", ("etl_dsl/*.py", "etl_dsl/grammar.lark")),
    ("harness", "Arnés de medición", ("benchmarks/*.py",)),
    ("programs", "Programas medidos", ("benchmarks/programs/*.etl",)),
)
SOURCE_RULE = "etl_dsl/*.py, etl_dsl/grammar.lark, benchmarks/*.py y benchmarks/programs/*.etl"


def _source_group(path):
    for group, _, patterns in SOURCE_GROUPS:
        if any(Path(path).match(pattern) and len(Path(path).parts) == len(Path(pattern).parts)
               for pattern in patterns):
            return group
    return None


def source_paths(root):
    """Rutas relativas (con /) que la regla del arnés registraría en ``root``."""
    root = Path(root)
    found = set()
    for _, _, patterns in SOURCE_GROUPS:
        for pattern in patterns:
            found.update(p.relative_to(root).as_posix() for p in root.glob(pattern) if p.is_file())
    return sorted(found)


def compare_sources(recorded, root):
    """Compara los hashes registrados por la campaña con los archivos de ``root``.

    No interpreta el resultado más allá de los bytes: la máquina, el entorno y la
    fecha siguen siendo los de la campaña aunque todas las fuentes coincidan.
    """
    if not isinstance(recorded, dict) or not recorded:
        raise EvidenceError("metadata: environment.source_sha256 ausente o vacío")
    for path, value in recorded.items():
        if _source_group(path) is None:
            raise EvidenceError(f"metadata: fuente {path} fuera de la regla del arnés")
        if not (isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)):
            raise EvidenceError(f"metadata: hash inválido para {path}")
    root = Path(root)
    current = source_paths(root)
    different = sorted(p for p in recorded if p in current and digest((root / p).read_bytes()) != recorded[p])
    missing = sorted(p for p in recorded if p not in current)
    added = sorted(p for p in current if p not in recorded)
    groups = []
    for group, label, _ in SOURCE_GROUPS:
        paths = [p for p in recorded if _source_group(p) == group]
        groups.append({"id": group, "label": label, "recorded": len(paths),
                       "matching": sum(p not in different and p not in missing for p in paths),
                       "added": [p for p in added if _source_group(p) == group]})
    status = "mismatch" if different or missing else "match_with_additions" if added else "match"
    return {"rule": SOURCE_RULE, "status": status, "recorded": len(recorded),
            "matching": len(recorded) - len(different) - len(missing),
            "different": different, "missing": missing, "added": added, "groups": groups}


def digest(data):
    return sha256(data).hexdigest()


def _fail(file, message):
    raise EvidenceError(f"{file}: {message}")


def _rows(file, data, fields):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        _fail(file, "no es UTF-8")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if tuple(reader.fieldnames or ()) != fields:
        _fail(file, f"encabezado {reader.fieldnames} distinto de {list(fields)}")
    rows = list(reader)
    for number, row in enumerate(rows, 2):
        if None in row or any(value is None for value in row.values()):
            _fail(file, f"fila {number} con número de columnas incorrecto")
    return rows


def _int(file, row, field, number):
    value = row[field]
    if not value.isdigit():
        _fail(file, f"fila {number}: {field}={value!r} no es un entero no negativo")
    return int(value)


def _float(file, row, field, number, *, allow_empty=False):
    value = row[field]
    if allow_empty and value == "":
        return None
    try:
        parsed = float(value)
    except ValueError:
        _fail(file, f"fila {number}: {field}={value!r} no es numérico")
    if not math.isfinite(parsed):
        _fail(file, f"fila {number}: {field}={value!r} no es finito")
    return parsed


def _bool(file, value, number):
    if value not in ("True", "False"):
        _fail(file, f"fila {number}: changed={value!r} no es True/False")
    return value == "True"


def _names(value):
    return [name for name in value.split(",") if name] if value else []


def load(directory, metadata_name="metadata.json"):
    """Lee los seis artefactos usados por la página como bytes y estructuras."""
    directory = Path(directory)
    names = ("samples.csv", "summary.csv", "structure.csv", "structure.json", "errors.csv", metadata_name)
    missing = [name for name in names if not (directory / name).is_file()]
    if missing:
        raise EvidenceError(f"Faltan artefactos de la campaña en {directory.name}: {', '.join(missing)}")
    raw = {name: (directory / name).read_bytes() for name in names}
    try:
        metadata = json.loads(raw[metadata_name])
        structure = json.loads(raw["structure.json"])
    except json.JSONDecodeError as exc:
        raise EvidenceError(f"JSON inválido: {exc}") from exc
    return {"raw": raw, "metadata_name": metadata_name, "metadata": metadata, "structure_json": structure,
            "samples": _rows("samples.csv", raw["samples.csv"], SAMPLE_FIELDS),
            "summary": _rows("summary.csv", raw["summary.csv"], SUMMARY_FIELDS),
            "structure": _rows("structure.csv", raw["structure.csv"], STRUCTURE_FIELDS),
            "errors": _rows("errors.csv", raw["errors.csv"], ERROR_FIELDS)}


def _metadata(metadata, file):
    required = ("status", "mode", "sizes", "seed", "repetitions", "warmups", "scenarios", "configurations",
                "environment", "unit", "equivalence", "contract_checks", "expressivity", "row_comparison",
                "samples_include_only_validated_results", "started_utc", "finished_utc", "datasets")
    missing = [key for key in required if key not in metadata]
    if missing:
        _fail(file, f"faltan campos {missing}")
    if metadata["status"] != "valid" or metadata["samples_include_only_validated_results"] is not True:
        _fail(file, "la campaña no está marcada como válida")
    if metadata["unit"] != "ms":
        _fail(file, f"unidad {metadata['unit']!r} desconocida")
    sizes, scenarios = metadata["sizes"], metadata["scenarios"]
    if (not sizes or len(set(sizes)) != len(sizes) or any(type(s) is not int or s <= 0 for s in sizes)
            or not scenarios or len(set(scenarios)) != len(scenarios)
            or not set(scenarios) <= {"normal", "final_flags_none"}):
        _fail(file, "tamaños o escenarios inválidos")
    if type(metadata["repetitions"]) is not int or metadata["repetitions"] < 1:
        _fail(file, "repeticiones inválidas")
    configurations = metadata["configurations"]
    if "O0" not in configurations or configurations["O0"] != [] or MANUAL in configurations:
        _fail(file, "configuraciones incompatibles: O0 debe existir sin pases y manual no es del compilador")
    workloads = [entry.get("workload") for entry in metadata["expressivity"]]
    if not workloads or len(set(workloads)) != len(workloads) or set(workloads) != set(metadata["row_comparison"]):
        _fail(file, "workloads de expresividad y comparación de filas no coinciden")
    if not all(entry.get("valid") is True for entry in metadata["equivalence"]):
        _fail(file, "hay comprobaciones de equivalencia no válidas")
    git = metadata["environment"].get("git_revision")
    if not isinstance(git, str) or len(git) != 40:
        _fail(file, "revisión Git medida ausente")
    return workloads


def validate(campaign):
    """Valida esquemas, celdas, recálculos y referencias cruzadas. Devuelve recuentos."""
    file = campaign["metadata_name"]
    metadata = campaign["metadata"]
    workloads = _metadata(metadata, file)
    configurations = metadata["configurations"]
    sizes, scenarios, repetitions = metadata["sizes"], metadata["scenarios"], metadata["repetitions"]

    # Celdas esperadas exactamente: la compilación no se multiplica por tamaño ni escenario.
    expected = {("compile", w, 0, c, "not_applicable") for w in workloads for c in configurations}
    expected |= {("execute", w, s, c, e) for w in workloads for s in sizes for e in scenarios
                 for c in [*configurations, MANUAL]}

    samples, cells, sequences = [], defaultdict(list), set()
    for number, row in enumerate(campaign["samples"], 2):
        sequence = _int("samples.csv", row, "sequence", number)
        size = _int("samples.csv", row, "size", number)
        seed = _int("samples.csv", row, "seed", number)
        repetition = _int("samples.csv", row, "repetition", number)
        value = _float("samples.csv", row, "value", number)
        if sequence in sequences:
            _fail("samples.csv", f"fila {number}: secuencia {sequence} duplicada")
        sequences.add(sequence)
        phase, workload, configuration, scenario = row["phase"], row["workload"], row["configuration"], row["scenario"]
        if phase not in PHASES:
            _fail("samples.csv", f"fila {number}: fase {phase!r} desconocida")
        if workload not in workloads:
            _fail("samples.csv", f"fila {number}: workload {workload!r} desconocido")
        if configuration != MANUAL and configuration not in configurations:
            _fail("samples.csv", f"fila {number}: configuración {configuration!r} desconocida")
        if row["unit"] != "ms" or value < 0:
            _fail("samples.csv", f"fila {number}: unidad o valor inválido")
        if seed != metadata["seed"]:
            _fail("samples.csv", f"fila {number}: semilla {seed} distinta de la campaña")
        if row["passes"] != ",".join(configurations.get(configuration, [])):
            _fail("samples.csv", f"fila {number}: pases {row['passes']!r} no corresponden a {configuration}")
        key = (phase, workload, size, configuration, scenario)
        if key not in expected:
            _fail("samples.csv", f"fila {number}: celda incompatible {key} (compilación usa size=0 y "
                                 "not_applicable; manual no compila; tamaños/escenarios de metadata)")
        if not 1 <= repetition <= repetitions:
            _fail("samples.csv", f"fila {number}: repetición {repetition} fuera de 1..{repetitions}")
        cells[key].append(repetition)
        samples.append({**row, "sequence": sequence, "size": size, "seed": seed, "repetition": repetition, "value": value})
    if set(cells) != expected:
        missing = sorted(expected - set(cells), key=str)
        _fail("samples.csv", f"faltan {len(missing)} celdas, por ejemplo {missing[:3]}")
    for key, reps in cells.items():
        if sorted(reps) != list(range(1, repetitions + 1)):
            _fail("samples.csv", f"celda {key}: repeticiones {sorted(reps)} en lugar de 1..{repetitions}")
    if sequences != set(range(1, len(samples) + 1)):
        _fail("samples.csv", "las secuencias no son consecutivas desde 1")

    # Resumen: mismas claves y valores exactos recalculados con la regla del arnés.
    recomputed = {tuple(str(r[k]) for k in KEY_FIELDS): r for r in summarize(samples)}
    seen = set()
    for number, row in enumerate(campaign["summary"], 2):
        key = tuple(row[k] for k in KEY_FIELDS)
        if key in seen:
            _fail("summary.csv", f"fila {number}: celda duplicada {key}")
        seen.add(key)
        if key not in recomputed:
            _fail("summary.csv", f"fila {number}: celda {key} sin muestras")
        _int("summary.csv", row, "n", number)
        for field in ("median", "p25", "p75", "iqr", "min", "max", "speedup_vs_O0"):
            _float("summary.csv", row, field, number)
        if row["unit"] != "ms":
            _fail("summary.csv", f"fila {number}: unidad {row['unit']!r}")
        for field in ("n", "median", "p25", "p75", "iqr", "min", "max", "speedup_vs_O0"):
            if str(recomputed[key][field]) != row[field]:
                _fail("summary.csv", f"fila {number}: {field}={row[field]} difiere del recálculo "
                                     f"{recomputed[key][field]} desde samples.csv")
    if seen != set(recomputed):
        _fail("summary.csv", f"faltan {len(set(recomputed) - seen)} resúmenes")

    # Estructura: CSV y JSON describen los mismos 7 × workloads registros.
    structure_json = campaign["structure_json"]
    if not isinstance(structure_json, list):
        _fail("structure.json", "debe ser una lista")
    by_key = {}
    for entry in structure_json:
        key = (entry.get("workload"), entry.get("configuration"))
        if key in by_key:
            _fail("structure.json", f"registro duplicado {key}")
        by_key[key] = entry
    expected_structure = {(w, c) for w in workloads for c in configurations}
    if set(by_key) != expected_structure:
        _fail("structure.json", "registros incompletos o configuraciones desconocidas")
    csv_keys = set()
    for number, row in enumerate(campaign["structure"], 2):
        key = (row["workload"], row["configuration"])
        if key in csv_keys or key not in by_key:
            _fail("structure.csv", f"fila {number}: registro duplicado o desconocido {key}")
        csv_keys.add(key)
        entry = by_key[key]
        before = [n for p in entry["before"]["pipelines"] for n in p["nodes"]]
        after = [n for p in entry["after"]["pipelines"] for n in p["nodes"]]
        parsed = {"passes": _names(row["passes"]), "nodes_before": _int("structure.csv", row, "nodes_before", number),
                  "nodes_after": _int("structure.csv", row, "nodes_after", number),
                  "changed": _bool("structure.csv", row["changed"], number),
                  "removed": _names(row["removed"]), "added": _names(row["added"]), "modified": _names(row["modified"]),
                  "range_rewrites": _int("structure.csv", row, "range_rewrites", number),
                  "join_rewrites": _int("structure.csv", row, "join_rewrites", number)}
        for field, value in parsed.items():
            if entry.get(field) != value:
                _fail("structure.csv", f"fila {number}: {field} no coincide con structure.json")
        if (parsed["passes"] != configurations[row["configuration"]] or parsed["nodes_before"] != len(before)
                or parsed["nodes_after"] != len(after)
                or parsed["range_rewrites"] != len(entry["after"]["range_rewrites"])
                or parsed["join_rewrites"] != len(entry["after"]["join_rewrites"])
                or parsed["changed"] != bool(parsed["removed"] or parsed["added"] or parsed["modified"])):
            _fail("structure.csv", f"fila {number}: recuentos incompatibles con la IR de structure.json")
    for entry in metadata["expressivity"]:
        if entry["dsl_nodes"] != by_key[(entry["workload"], "O0")]["nodes_before"]:
            _fail(file, f"nodos de expresividad de {entry['workload']} no coinciden con la IR")

    # Errores: corpus separado, códigos exigidos igual a observados y recuento de metadata.
    error_keys = set()
    for number, row in enumerate(campaign["errors"], 2):
        key = (row["phase"], row["workload"], row["case"], row["configuration"])
        if key in error_keys:
            _fail("errors.csv", f"fila {number}: comprobación duplicada {key}")
        error_keys.add(key)
        if row["expected"] != row["observed"] or not row["expected"].startswith("E_"):
            _fail("errors.csv", f"fila {number}: código observado {row['observed']} distinto de {row['expected']}")
        allowed = (configurations if row["phase"] == "compile" else [*configurations, MANUAL])
        if row["phase"] not in ("compile", "runtime") or row["configuration"] not in allowed:
            _fail("errors.csv", f"fila {number}: fase/configuración incompatible")
        if row["phase"] == "runtime" and row["workload"] not in workloads:
            _fail("errors.csv", f"fila {number}: workload desconocido")
    if len(campaign["errors"]) != metadata["contract_checks"]:
        _fail("errors.csv", f"{len(campaign['errors'])} comprobaciones; metadata declara {metadata['contract_checks']}")
    datasets = {(d["workload"], d["size"]) for d in metadata["datasets"]}
    if datasets != {(w, s) for w in workloads for s in sizes}:
        _fail(file, "manifiestos de datasets incompletos")
    return {"samples": len(samples), "cells": len(seen), "structure": len(csv_keys),
            "errors": len(campaign["errors"]), "equivalence": len(metadata["equivalence"])}


def serialize_json(value):
    """Formato exacto de report.export, para comprobar que solo cambia lo redactado."""
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def redact_metadata(raw):
    metadata = json.loads(raw)
    if serialize_json(metadata) != raw:
        raise EvidenceError("metadata.json no conserva el formato del arnés; no se puede depurar sin alterar otros bytes")
    applied = []
    for section, field, reason in REDACTIONS:
        if field in metadata.get(section, {}):
            metadata[section][field] = REDACTED
            applied.append({"pointer": f"/{section}/{field}", "replacement": REDACTED, "reason": reason})
    return serialize_json(metadata), applied


def check_public(raw_by_name):
    """Ningún archivo público puede contener rutas absolutas del host."""
    for name, data in raw_by_name.items():
        text = data.decode("utf-8", errors="replace")
        for marker in ("/Users/", "/home/", "C:\\Users\\"):
            if marker in text:
                raise EvidenceError(f"{name}: contiene una ruta local ({marker}); debe depurarse antes de publicar")


def publish(source, destination, curation):
    """Copia/depura los archivos autorizados de una campaña validada y escribe manifest.json."""
    source, destination = Path(source), Path(destination)
    campaign = load(source)
    counts = validate(campaign)
    files, public = [], {}
    for entry in curation["files"]:
        original = (source / entry["source"]).read_bytes()
        if entry["publish"] == "copy":
            data, redactions = original, []
        elif entry["publish"] == "redact_metadata":
            data, redactions = redact_metadata(original)
        else:
            raise EvidenceError(f"Modo de publicación desconocido: {entry['publish']}")
        public[entry["path"]] = data
        files.append({"path": entry["path"], "role": entry["role"], "media_type": entry["media_type"],
                      "bytes": len(data), "sha256": digest(data),
                      "original": {"path": entry["source"], "bytes": len(original), "sha256": digest(original)},
                      "identical_to_original": data == original, "redactions": redactions})
    check_public(public)
    meta = campaign["metadata"]
    manifest = {
        "format_version": 1,
        "campaign": {"id": curation["campaign"], "mode": meta["mode"], "started_utc": meta["started_utc"],
                     "finished_utc": meta["finished_utc"], "measured_revision": meta["environment"]["git_revision"],
                     "seed": meta["seed"], "sizes": meta["sizes"], "scenarios": meta["scenarios"],
                     "warmups": meta["warmups"], "repetitions": meta["repetitions"], "counts": counts},
        "provenance": {"source_directory": curation["source"],
                       "producer": "python -m benchmarks (benchmarks/harness.py, benchmarks/report.py)",
                       "publisher": "web/scripts/gen_evaluation.py --import-campaign",
                       "notes": curation["provenance_notes"]},
        "files": files,
    }
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in public.items():
        (destination / name).write_bytes(data)
    (destination / "manifest.json").write_bytes(serialize_json(manifest))
    return manifest


def load_snapshot(directory):
    """Comprueba hashes y archivos del manifiesto y valida la campaña pública."""
    directory = Path(directory)
    path = directory / "manifest.json"
    if not path.is_file():
        raise EvidenceError(f"Falta {path.name} en la instantánea pública {directory}")
    manifest = json.loads(path.read_bytes())
    listed = {entry["path"] for entry in manifest["files"]}
    present = {p.name for p in directory.iterdir() if p.is_file() and p.name != "manifest.json"}
    if listed != present:
        raise EvidenceError(f"Archivos no autorizados o ausentes en la instantánea: {sorted(listed ^ present)}")
    raw = {}
    for entry in manifest["files"]:
        data = (directory / entry["path"]).read_bytes()
        if digest(data) != entry["sha256"] or len(data) != entry["bytes"]:
            raise EvidenceError(f"{entry['path']}: hash publicado distinto del manifiesto")
        if entry["identical_to_original"] != (entry["sha256"] == entry["original"]["sha256"]):
            raise EvidenceError(f"{entry['path']}: marca de copia idéntica incoherente")
        raw[entry["path"]] = data
    check_public(raw)
    metadata_name = next(e["path"] for e in manifest["files"] if e["path"].startswith("metadata"))
    campaign = load(directory, metadata_name)
    counts = validate(campaign)
    if counts != manifest["campaign"]["counts"]:
        raise EvidenceError("Los recuentos validados no coinciden con el manifiesto")
    return manifest, campaign, raw


def verify_originals(directory, manifest):
    """Con los originales locales, comprueba hashes y que lo depurado sea exactamente la regla aplicada."""
    directory = Path(directory)
    for entry in manifest["files"]:
        original = (directory / entry["original"]["path"]).read_bytes()
        if digest(original) != entry["original"]["sha256"]:
            raise EvidenceError(f"{entry['original']['path']}: el original local ya no coincide con el manifiesto")
        if entry["redactions"] and digest(redact_metadata(original)[0]) != entry["sha256"]:
            raise EvidenceError(f"{entry['path']}: la depuración no reproduce el archivo publicado")


def _flags(text):
    flags = {}
    for line in (text or "").splitlines():
        name, _, value = line.strip().partition(":")
        if value.strip() in ("True", "False"):
            flags[name] = value.strip() == "True"
    return flags


def _rewrite_summary(after):
    ranges = [{"node": r["node"], "action": r["action"], "before": r["before"], "after": r["after"],
               "reason": r["reason"], "consumers": r.get("consumers", []),
               "facts": sorted({(f["name"], json.dumps(f.get("lower"), sort_keys=True), json.dumps(f.get("upper"), sort_keys=True), f["nullable"])
                                for f in r["proof"]})}
              for r in after["range_rewrites"]]
    for r in ranges:
        r["facts"] = [{"column": name, "lower": _bound(json.loads(lo)), "upper": _bound(json.loads(hi)), "nullable": nullable}
                      for name, lo, hi, nullable in r["facts"]]
    joins = [{key: j[key] for key in ("node", "action", "guarantee", "retained", "eliminated", "consumers",
                                      "static_proof", "obligations", "verification")}
             for j in after["join_rewrites"]]
    return ranges, joins


def _bound(bound):
    return None if bound is None else {"value": bound["value"], "inclusive": bound["inclusive"]}


def page_data(manifest, campaign, curation, href):
    """Datos de /evaluacion: todo número procede de los CSV/JSON validados."""
    meta = campaign["metadata"]
    env = meta["environment"]
    summary = {tuple(r[k] for k in KEY_FIELDS): r for r in campaign["summary"]}
    values = defaultdict(dict)
    for row in campaign["samples"]:
        key = tuple(row[k] for k in KEY_FIELDS)
        values[key][int(row["repetition"])] = float(row["value"])
    cells = []
    for key in sorted(summary, key=lambda k: (k[0], k[1], int(k[2]), k[6], k[4])):
        row = summary[key]
        cells.append({"phase": row["phase"], "workload": row["workload"], "size": int(row["size"]),
                      "scenario": row["scenario"], "configuration": row["configuration"], "passes": _names(row["passes"]),
                      "n": int(row["n"]), **{f: float(row[f]) for f in ("median", "p25", "p75", "iqr", "min", "max")},
                      "ratio": float(row["speedup_vs_O0"]),
                      "samples": [values[key][i] for i in sorted(values[key])]})
    structure = []
    for entry in campaign["structure_json"]:
        ranges, joins = _rewrite_summary(entry["after"])
        structure.append({k: entry[k] for k in ("workload", "configuration", "passes", "nodes_before", "nodes_after",
                                                 "changed", "removed", "added", "modified")}
                         | {"operators_before": dict(sorted(entry["operators_before"].items())),
                            "operators_after": dict(sorted(entry["operators_after"].items())),
                            "range_rewrites": ranges, "join_rewrites": joins})
    groups = defaultdict(list)
    for row in campaign["errors"]:
        groups[(row["phase"], row["workload"], row["case"], row["expected"], row["observed"], row["plain_polars"])].append(row["configuration"])
    errors = [{"phase": k[0], "workload": k[1], "case": k[2], "expected": k[3], "observed": k[4],
               "plain_polars": k[5], "configurations": v} for k, v in groups.items()]
    equivalence = Counter(e["case"] for e in meta["equivalence"])
    workload_text = curation["workloads"]
    if set(workload_text) != set(meta["row_comparison"]):
        raise EvidenceError("La curaduría de workloads no coincide con la campaña")
    return {
        "format_version": 1,
        "campaign": {
            "id": manifest["campaign"]["id"], "mode": meta["mode"], "status": meta["status"],
            "started_utc": meta["started_utc"], "finished_utc": meta["finished_utc"],
            "revision": env["git_revision"], "git_status": env["git_status"],
            "seed": meta["seed"], "sizes": meta["sizes"], "scenarios": meta["scenarios"],
            "warmups": meta["warmups"], "repetitions": meta["repetitions"],
            "configurations": meta["configurations"],
            # El JSON se serializa con claves ordenadas: el orden del arnés viaja como lista explícita.
            "configuration_order": [*meta["configurations"], MANUAL],
            "clock": meta["clock"], "unit": meta["unit"],
            "dispersion": meta["dispersion"], "input_scenario": meta["input_scenario"],
            "compile_scope": meta["compile_scope"], "compile_excludes": meta["compile_excludes"],
            "execution_scope": meta["execution_scope"], "execution_excludes": meta["execution_excludes"],
            "engine_options": meta["engine_options"], "order": meta["order"], "cache_policy": meta["cache_policy"],
            "environment": {"python": env["python"], "polars": env["polars"], "lark": env["lark"],
                            "compiler_version": env["compiler_version"], "contract_version": env["contract_version"],
                            "platform": env["platform"], "machine": env["machine"], "cpu": env["cpu"],
                            "logical_cpu_count": env["logical_cpu_count"], "memory_bytes": int(env["memory_bytes"]),
                            "polars_threads": env["polars_threads"], "variables": env["environment"]},
            "flags": {"default": _flags(env["query_opt_flags_default"]), "none": _flags(env["query_opt_flags_none"])},
            "equivalence": {"total": len(meta["equivalence"]), "by_case": dict(sorted(equivalence.items())),
                            "configurations": sorted({e["configuration"] for e in meta["equivalence"]})},
            "contract_checks": meta["contract_checks"], "counts": manifest["campaign"]["counts"],
        },
        "workloads": [{"id": w["workload"], **workload_text[w["workload"]],
                       "row_comparison": meta["row_comparison"][w["workload"]],
                       "expressivity": {k: v for k, v in w.items() if k != "workload"}}
                      for w in meta["expressivity"]],
        "cells": cells, "structure": structure, "errors": errors,
        "downloads": {"base": href, "manifest": {"path": "manifest.json"}, "files": manifest["files"]},
        "provenance": manifest["provenance"],
    }
