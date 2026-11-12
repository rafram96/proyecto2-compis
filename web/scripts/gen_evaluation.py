"""Evidencia C5 publicada para /evaluacion. Ejecutar desde la raíz del repositorio.

Uso habitual (checkout limpio): valida la instantánea pública versionada y genera
web/src/evaluation/generated.json; --check falla si algo diverge.

Solo al publicar una campaña: --import-campaign DIR copia/depura los archivos
autorizados por web/content/evaluation.json desde benchmarks/results/ (ignorado)
y escribe manifest.json con hashes del original y del publicado. --originals DIR
vuelve a comprobar esos hashes cuando los originales existen en este equipo.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from benchmarks.evidence import (EvidenceError, compare_sources, digest, load_snapshot,  # noqa: E402
                                 page_data, publish, verify_originals)

CURATION = ROOT / "web/content/evaluation.json"
DEST = ROOT / "web/src/evaluation/generated.json"


def curation():
    return json.loads(CURATION.read_text(encoding="utf-8"))


def snapshot_dir(selection=None):
    return ROOT / (selection or curation())["snapshot"]


def build(snapshot=None, root=ROOT):
    """``root`` es el checkout cuyas fuentes se comparan con las de la campaña."""
    selection = curation()
    directory = Path(snapshot) if snapshot else snapshot_dir(selection)
    manifest, campaign, _ = load_snapshot(directory)
    if [f["path"] for f in manifest["files"]] != [f["path"] for f in selection["files"]]:
        raise EvidenceError("La instantánea no publica exactamente los archivos autorizados por la curaduría")
    data = page_data(manifest, campaign, selection, selection["href"])
    raw = (directory / "manifest.json").read_bytes()
    data["downloads"]["manifest"] |= {"bytes": len(raw), "sha256": digest(raw)}
    # La curaduría declara qué pases aislados transforman cada programa; la IR medida debe confirmarlo.
    for workload in data["workloads"]:
        changed = {s["configuration"] for s in data["structure"]
                   if s["workload"] == workload["id"] and s["changed"] and s["configuration"] not in ("O0", "default")}
        if changed != set(workload["expected"]):
            raise EvidenceError(f"{workload['id']}: pases que transforman {sorted(changed)} ≠ curaduría {workload['expected']}")
    # Se calcula, nunca se escribe a mano: --check falla si la conclusión deja de ser cierta.
    data["sources"] = compare_sources(campaign["metadata"]["environment"]["source_sha256"], root)
    return data


def serialized(snapshot=None, root=ROOT):
    return json.dumps(build(snapshot, root), ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def describe_sources(sources):
    if sources["status"] == "mismatch":
        changed = sources["different"] + [f"{p} (ausente)" for p in sources["missing"]]
        return f"fuentes distintas de las medidas: {', '.join(changed)}"
    extra = f"; añadidas después: {', '.join(sources['added'])}" if sources["added"] else ""
    return f"las {sources['recorded']} fuentes registradas coinciden con las medidas{extra}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="Falla si la instantánea o el JSON generado divergen")
    parser.add_argument("--import-campaign", type=Path, metavar="DIR", help="Publica la campaña original indicada")
    parser.add_argument("--originals", type=Path, metavar="DIR", help="Comprueba los hashes de los originales locales")
    args = parser.parse_args()
    selection = curation()
    try:
        if args.import_campaign:
            if args.check:
                parser.error("--import-campaign y --check son excluyentes")
            target = snapshot_dir(selection)
            if (target / "manifest.json").exists():
                current = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
                originals = {f["original"]["path"]: f["original"]["sha256"] for f in current["files"]}
                incoming = {p: digest((args.import_campaign / p).read_bytes()) for p in originals}
                if originals != incoming:
                    raise EvidenceError("Ya hay otra campaña publicada; elimine la instantánea explícitamente antes de sustituirla")
            manifest = publish(args.import_campaign, target, selection)
            print(f"Publicada {manifest['campaign']['id']}: {len(manifest['files'])} archivos en {target.relative_to(ROOT)}")
        if args.originals:
            manifest = json.loads((snapshot_dir(selection) / "manifest.json").read_text(encoding="utf-8"))
            verify_originals(args.originals, manifest)
            print(f"Originales locales coinciden con el manifiesto: {args.originals}")
        content = serialized()
    except (EvidenceError, OSError, KeyError) as exc:
        raise SystemExit(f"Evidencia C5 inválida: {exc}")
    sources = json.loads(content)["sources"]
    if args.check:
        if not DEST.exists() or DEST.read_text(encoding="utf-8") != content:
            previous = json.loads(DEST.read_text(encoding="utf-8")).get("sources") if DEST.exists() else None
            if previous != sources:
                raise SystemExit("Evaluación desactualizada: la correspondencia de fuentes con la campaña cambió ("
                                 + describe_sources(sources)
                                 + "). Ejecuta .venv/bin/python web/scripts/gen_evaluation.py y revisa el texto de /evaluacion")
            raise SystemExit("Evaluación desactualizada: ejecuta .venv/bin/python web/scripts/gen_evaluation.py")
    else:
        DEST.parent.mkdir(parents=True, exist_ok=True)
        DEST.write_text(content, encoding="utf-8")
    print("OK evidencia C5: " + str(DEST.relative_to(ROOT)) + "; " + describe_sources(sources))


if __name__ == "__main__":
    main()
