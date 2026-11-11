FROM python:3.12-slim AS compiler

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app
WORKDIR /app
COPY requirements.txt requirements-service.txt ./
RUN pip install -r requirements-service.txt
COPY etl_dsl ./etl_dsl
COPY service ./service
COPY scripts ./scripts
COPY tests ./tests
COPY input ./input
COPY demo ./demo
COPY main.py ./
# Las pruebas actuales incluyen paridad web y evaluación; copiar sus fuentes canónicas.
COPY benchmarks ./benchmarks
COPY docs ./docs
COPY web/content ./web/content
COPY web/scripts ./web/scripts
COPY web/src/compiler ./web/src/compiler
COPY web/src/content/generated.json ./web/src/content/generated.json
CMD ["sh", "-c", "python scripts/create_demo_data.py && python main.py --run"]

FROM node:24-slim AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
COPY etl_dsl /build/etl_dsl
RUN npm run build

FROM compiler AS service
COPY --from=web-build /build/web/dist /app/web/dist
EXPOSE 8000
CMD ["sh", "-c", "python -m service.prepare && exec python -m uvicorn service.app:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log"]
