"""Publica solo los manifiestos explícitos. Ejecutar desde la raíz del repo.

No genera IR/Python ni lee datasets: los programas se leen de su fuente canónica;
los artículos seleccionan secciones exactas de documentación vigente.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
DEST = WEB / "src/content/generated.json"
STUDIO_LINK = re.compile(r"/estudio(?:\?vista=(?:resultado|tokens|arbol|ast|flow|ir|esquemas|python|ejecucion))?")


def manifest(name):
    return json.loads((WEB / f"content/{name}.json").read_text(encoding="utf-8"))


def validate_slugs(entries):
    slugs = [entry["slug"] for entry in entries]
    if len(slugs) != len(set(slugs)) or any(not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) for slug in slugs):
        raise ValueError("Slugs duplicados o inválidos")


def build_content():
    examples, articles = manifest("examples"), manifest("articles")
    validate_slugs(examples)
    validate_slugs(articles)
    example_slugs = {e["slug"] for e in examples}
    article_slugs = {a["slug"] for a in articles}
    for example in examples:
        if not set(example["docs"]) <= article_slugs:
            raise ValueError("Artículo inexistente en ejemplo")
        example["code"] = (ROOT / example["source"]).read_text(encoding="utf-8")
        example["sourceHash"] = hashlib.sha256(example["code"].encode()).hexdigest()
    for article in articles:
        if not set(article["examples"] + [article["program"]]) <= example_slugs:
            raise ValueError("Ejemplo inexistente en artículo")
        parts = []
        for source in article["sources"]:
            text = (ROOT / source["path"]).read_text(encoding="utf-8")
            sections = {match[1]: match[0] for match in re.finditer(r"^## (.+)\n(?:(?!^## ).|\n)*", text, re.M)}
            if source["sections"]:
                parts.extend(sections[heading] for heading in source["sections"])
            else:
                parts.append(text.split("\n", 1)[1])
            source["hash"] = hashlib.sha256(text.encode()).hexdigest()
        # Enlaces técnicos relativos no publicados se leen como texto; nunca apuntan a rutas SPA inexistentes.
        links = {"lenguaje.md": "/docs/estructura", "semantica_estatica.md": "/docs/null-contratos",
                 "backend_polars.md": "/docs/conectores", "tutorial.md": "/docs/tutorial",
                 "../demo/joins.etl": "/ejemplos/join-verificado", "../demo/tutorial.etl": "/ejemplos/gasto-por-cliente"}
        def link(match):
            label, url = match.groups()
            if url.startswith("/estudio"):
                # Solo vistas publicadas (web/src/workspace/view.ts); un enlace roto falla aquí.
                if not STUDIO_LINK.fullmatch(url):
                    raise ValueError(f"Enlace al estudio no publicado: {url}")
                return match[0]
            if url.startswith(("https://", "/docs/", "/ejemplos/")):
                return match[0]
            return f"[{label}]({links[url]})" if url in links else label
        article["body"] = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, "\n\n".join(parts).strip())
    return {"examples": examples, "articles": articles}


def serialized():
    return json.dumps(build_content(), ensure_ascii=False, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Falla si falta regenerar contenido")
    args = parser.parse_args()
    content = serialized()
    if args.check:
        if not DEST.exists() or DEST.read_text(encoding="utf-8") != content:
            raise SystemExit("Contenido desactualizado: ejecuta .venv/bin/python web/scripts/gen_content.py")
    else:
        DEST.write_text(content, encoding="utf-8")
    print("OK catálogo y artículos: " + str(DEST.relative_to(ROOT)))


if __name__ == "__main__":
    main()
