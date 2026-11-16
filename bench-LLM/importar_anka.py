"""Importa una copia verificable del benchmark de Anka, fijada a un commit."""
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
COMMIT = "540128d90b74c125eb5881f7bb42246d2e89bc7e"
REPOSITORY = "https://github.com/BleBlo/Anka"
URL = f"https://codeload.github.com/BleBlo/Anka/zip/{COMMIT}"


def keep_path(relative):
    """Solo el corpus usado, la metodología y los avisos de origen."""
    return (str(relative) in {"LICENSE", "README.md", "benchmarks/METHODOLOGY.md"}
            or (relative.parts[:2] == ("benchmarks", "tasks") and relative.suffix == ".json"))


def main():
    target = HERE / "upstream"
    if target.exists():
        raise SystemExit("upstream ya existe; se conserva la copia importada.")
    request = urllib.request.Request(URL, headers={"User-Agent": "Capybara-benchmark"})
    with urllib.request.urlopen(request, timeout=90) as response:
        archive = response.read()
    files = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        for item in bundle.infolist():
            relative = PurePosixPath(*PurePosixPath(item.filename).parts[1:])
            if item.is_dir() or not relative.parts:
                continue
            if not keep_path(relative):
                continue
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"Ruta inválida: {relative}")
            data = bundle.read(item)
            destination = target.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            files[str(relative)] = hashlib.sha256(data).hexdigest()
    manifest = {"repository": REPOSITORY, "commit": COMMIT, "archive_url": URL,
                "imported_at": datetime.now(timezone.utc).isoformat(),
                "license": "MIT; ver upstream/LICENSE", "sha256": files}
    (HERE / "UPSTREAM.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Importados {len(files)} archivos de Anka @ {COMMIT}.")


if __name__ == "__main__":
    main()
