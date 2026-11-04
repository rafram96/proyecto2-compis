"""Datos locales reproducibles para los programas de input/, sin descargar datasets."""
import argparse
import csv
from pathlib import Path
import sqlite3

import duckdb


def create_demo_data(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "ventas.duckdb"
    if not path.exists():
        with duckdb.connect(str(path)) as con:
            con.execute("CREATE TABLE ventas(cliente_id BIGINT, monto DECIMAL(18,2), fecha TIMESTAMP)")
            con.execute("""INSERT INTO ventas VALUES
                (1, 100.50, '2026-01-01'), (1, 49.50, '2026-01-02'),
                (2, 25.00, '2026-01-03'), (2, NULL, '2026-01-04'),
                (3, -10.00, '2026-01-05')""")
    path = directory / "bank.db"
    if not path.exists():
        con = sqlite3.connect(path)
        try:
            con.executescript("""
                CREATE TABLE clients(id INTEGER, income REAL, debt REAL, segment TEXT);
                INSERT INTO clients VALUES (1, 1000, 200, 'A'), (2, 500, NULL, NULL),
                    (3, 0, 50, 'A'), (4, NULL, 10, 'B'), (5, 1000, -1, 'B');
                CREATE TABLE customers(id INTEGER, name TEXT, region TEXT);
                INSERT INTO customers VALUES (1, 'Ana', 'Lima'), (2, 'Luis', 'Cusco');
            """)
            con.commit()
        finally:
            con.close()
    path = directory / "orders.csv"
    if not path.exists():
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(["id", "customer_id", "amount", "status"])
            writer.writerows([(1, 1, "10.5", "paid"), (2, 2, "", ""), (3, 9, "30", "pending")])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=Path("input"))
    args = parser.parse_args()
    create_demo_data(args.directory)
    print(f"Datos demo disponibles en {args.directory.resolve()} (archivos existentes conservados).")
