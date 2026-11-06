FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app

WORKDIR /app

# Dependencias primero para reutilizar la capa si solo cambia el código.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY etl_dsl ./etl_dsl
COPY scripts ./scripts
COPY tests ./tests
COPY input ./input
COPY demo ./demo
COPY main.py ./

# Crea los datos de demo (si faltan), compila input/*.etl y ejecuta los pipelines.
CMD ["sh", "-c", "python scripts/create_demo_data.py && python main.py --run"]
