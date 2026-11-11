"""python -m service.prepare [directorio]: prepara v1 sin tocar input/ ni datos ajenos."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
from scripts.create_demo_data import create_demo_data
from .catalog import ENTRIES, ROOT, digest


def prepare(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        generated = Path(temp)
        create_demo_data(generated)
        (generated / 'ventas.csv').write_text('id,monto\n1,50.0\n2,100.0\n3,250.5\n4,\n5,1000.0\n', encoding='utf-8')
        # Derivado de la fuente canónica: caso de fallo explícito de la demo.
        canonical = (ROOT / 'demo/joins_clientes.csv').read_text(encoding='utf-8')
        (generated / 'joins_duplicados.csv').write_text(canonical + canonical.splitlines()[1] + '\n', encoding='utf-8')
        for name in {e.file for e in ENTRIES if not e.included}:
            destination = directory / name
            if destination.exists() and digest(destination) != digest(generated / name):
                raise ValueError(f'{name} ya existe con contenido distinto; elija otro directorio.')
        for name in {e.file for e in ENTRIES if not e.included}:
            shutil.copyfile(generated / name, directory / name)
    hashes = {e.id: digest(directory / e.file) for e in ENTRIES if not e.included}
    (directory / 'manifest.json').write_text(json.dumps(hashes, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='data/cauce-datasets')
    args = parser.parse_args()
    prepare(args.directory)
    print('Datasets v1 preparados; el catálogo se carga al iniciar el servicio.')
