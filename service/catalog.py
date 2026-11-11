"""Catálogo cerrado. Nunca interpreta rutas recibidas por HTTP como datos."""
from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from .schemas import Dataset

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Entry:
    id: str
    title: str
    file: str
    driver: str = 'CSV'
    options: tuple = ()
    included: bool = False
    version: str = '1'


ENTRIES = (
    Entry('orders', 'Pedidos sintéticos', 'orders.csv'),
    Entry('bank-clients', 'Clientes · riesgo', 'bank.db', 'SQLITE', (('table', 'clients'),)),
    Entry('bank-customers', 'Clientes · pedidos', 'bank.db', 'SQLITE', (('table', 'customers'),)),
    Entry('ranges-sales', 'Ventas · rangos', 'ventas.csv'),
    Entry('join-orders', 'JOIN · pedidos', 'joins_pedidos.csv', included=True),
    Entry('join-customers', 'JOIN · clientes únicos', 'joins_clientes.csv', included=True),
    Entry('join-duplicates', 'JOIN · duplicados (fallo intencional)', 'joins_duplicados.csv'),
)


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


class Catalog:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        manifest = self.directory / 'manifest.json'
        self.hashes = json.loads(manifest.read_text()) if manifest.is_file() else {}
        for e in ENTRIES:
            if e.included:
                self.hashes[e.id] = digest(self.path(e))

    def path(self, entry):
        return (ROOT / 'demo' if entry.included else self.directory) / entry.file

    def dataset(self, entry):
        path = self.path(entry)
        available = path.is_file() and entry.id in self.hashes and digest(path) == self.hashes[entry.id]
        return Dataset(id=entry.id, version=entry.version, title=entry.title,
                       driver=entry.driver, options=dict(entry.options), available=available,
                       sha256=self.hashes.get(entry.id), bytes=path.stat().st_size if available else None)

    def list(self):
        return [self.dataset(e) for e in ENTRIES]

    def resolve(self, dataset_id, version):
        entry = next((e for e in ENTRIES if e.id == dataset_id and e.version == version), None)
        if entry is None:
            raise ValueError('Dataset o versión no autorizados.')
        if not self.dataset(entry).available:
            raise ValueError(f'E_DATASET_UNAVAILABLE: dataset {entry.id}@{entry.version} ausente o modificado; ejecute python -m service.prepare.')
        return entry
