"""python -m etl_dsl.web: inicia el entorno en http://127.0.0.1:8000."""
import argparse
from pathlib import Path

import uvicorn

from .server import create_app


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description="Entorno web del DSL ETL")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Interfaz de red (por defecto solo este equipo: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--data", type=Path, default=Path("input"),
                        help="Base de rutas de SOURCE/SINK y única carpeta accesible (por defecto: input)")
    parser.add_argument("--examples", type=Path, nargs="+",
                        help="Carpetas con programas de ejemplo (por defecto: la de datos y demo)")
    args = parser.parse_args(argv)
    uvicorn.run(create_app(args.data, args.examples), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
