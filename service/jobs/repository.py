"""Metadatos acotados en SQLite; archivos y fuente temporal fuera de la base."""
from contextlib import contextmanager
import json
import sqlite3


class Repository:
    def __init__(self, path):
        self.path = path
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, record TEXT NOT NULL, private TEXT NOT NULL DEFAULT "{}")')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def all(self):
        with self.connect() as db:
            return [(json.loads(row[0]), json.loads(row[1])) for row in db.execute('SELECT record, private FROM runs')]

    def get(self, run_id):
        with self.connect() as db:
            row = db.execute('SELECT record, private FROM runs WHERE id=?', (run_id,)).fetchone()
        return (json.loads(row[0]), json.loads(row[1])) if row else None

    def put(self, record, private=None):
        with self.connect() as db:
            if private is None:
                db.execute('UPDATE runs SET record=? WHERE id=?', (json.dumps(record), record['id']))
            else:
                db.execute('INSERT INTO runs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record, private=excluded.private',
                           (record['id'], json.dumps(record), json.dumps(private)))

    def delete(self, run_id):
        with self.connect() as db:
            db.execute('DELETE FROM runs WHERE id=?', (run_id,))
