#!/bin/sh
# Arranque del entorno web en un contenedor (Render, Docker): crea los datos de demo
# si faltan y levanta el servidor en todas las interfaces, en el puerto de $PORT.
set -e
python scripts/create_demo_data.py
exec python -m etl_dsl.web --host 0.0.0.0 --port "${PORT:-8000}"
