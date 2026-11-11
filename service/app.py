"""uvicorn service.app:app --host 127.0.0.1 --port 8000 --workers 1"""
from contextlib import asynccontextmanager
import json
from pathlib import Path
from urllib.parse import quote
import os
import re

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from etl_dsl.passes import DEFAULT, PASSES
from etl_dsl.version import COMPILER_VERSION, CONTRACT_VERSION
from .catalog import Catalog
from .config import Settings
from .jobs.manager import CapacityError, Manager
from .runner.serialization import cell
from .schemas import Capabilities, Health, Preview, Run, RunRequest

ID = r'^[a-f0-9]{32}$'


def create_app(settings=None):
    settings = settings or Settings.environment()

    @asynccontextmanager
    async def lifespan(app):
        app.state.catalog = Catalog(settings.datasets)
        app.state.manager = Manager(settings, app.state.catalog)
        try:
            yield
        finally:
            app.state.manager.close()

    app = FastAPI(title='Cauce · ejecución privada', version='1', lifespan=lifespan,
                  docs_url='/api/v1/docs', redoc_url=None)

    @app.middleware('http')
    async def body_limit(request: Request, call_next):
        # Limita bytes recibidos incluso sin Content-Length. No confía en el encabezado.
        if request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 192 * 1024:
                    return JSONResponse(status_code=413, content={'detail': 'Cuerpo mayor que 192 KiB.'})
            request._body = bytes(body)
        # La demo usa mismo origen; impedir envíos cross-site incluso desde formularios simples.
        origin = request.headers.get('origin')
        if request.method == 'POST' and (request.headers.get('sec-fetch-site') == 'cross-site' or
                (origin and origin.rstrip('/') != str(request.base_url).rstrip('/'))):
            return JSONResponse(status_code=403, content={'detail': 'Use el mismo origen de la demo.'})
        return await call_next(request)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # FastAPI incluiría input=source en el detalle de validación.
        errors = [{'loc': list(e['loc']), 'msg': e['msg'], 'type': e['type']} for e in exc.errors()]
        return JSONResponse(status_code=422, content={'detail': errors})

    @app.get('/api/v1/health', response_model=Health)
    def health():
        if not app.state.manager.available:
            raise HTTPException(503, 'El gestor no está disponible; reinicie el servicio.')
        return Health()

    @app.get('/api/v1/capabilities', response_model=Capabilities)
    def capabilities():
        return Capabilities(compiler_version=COMPILER_VERSION, analysis_version=CONTRACT_VERSION,
            passes=list(PASSES), default_passes=list(DEFAULT),
            source_connectors=['CSV', 'PARQUET', 'SQLITE', 'DUCKDB'], sink_connectors=['CSV', 'PARQUET', 'DUCKDB'],
            datasets=app.state.catalog.list(),
            limits={k: v for k, v in vars(settings).items() if isinstance(v, (int, float))},
            isolation='Demo privada POSIX: proceso separado, rutas de IO autorizadas, RSS muestreado cada 50 ms; sin sandbox de red ni aislamiento público.')

    @app.post('/api/v1/runs', status_code=202, response_model=Run)
    def submit(request: RunRequest):
        if not app.state.manager.available:
            raise HTTPException(503, 'Ejecutor no disponible; la compilación local sigue funcionando.')
        try:
            return app.state.manager.submit(request)
        except CapacityError as exc:
            raise HTTPException(429, str(exc)) from exc
        except (ValueError, RecursionError) as exc:
            # Errores de binding/opciones no aceptados, nunca incluir el texto del fuente.
            raise HTTPException(422, str(exc) if isinstance(exc, ValueError) else 'Programa demasiado complejo.') from exc

    def job(run_id):
        if not re.fullmatch(ID, run_id):
            raise HTTPException(404, 'Trabajo desconocido.')
        item = app.state.manager.get(run_id)
        if item is None:
            raise HTTPException(404, 'Trabajo desconocido o eliminado tras caducar.')
        return item

    @app.get('/api/v1/runs/{run_id}', response_model=Run)
    def status(run_id: str):
        return job(run_id)[0]

    @app.post('/api/v1/runs/{run_id}/cancel', response_model=Run)
    def cancel(run_id: str):
        job(run_id)
        return app.state.manager.cancel(run_id)

    def file_for(run_id, resource_id, category):
        r, private = job(run_id)
        if r['expired']:
            raise HTTPException(410, 'Los archivos caducaron; vuelva a ejecutar el documento.')
        resource = next((o for o in r[category] if o['id'] == resource_id), None)
        if resource is None or resource_id not in private:
            raise HTTPException(404, 'Salida o archivo desconocido.')
        work = (settings.storage / run_id).resolve()
        path = work / private[resource_id]
        if not path.resolve().is_relative_to(work) or path.is_symlink() or not path.is_file():
            raise HTTPException(404, 'Archivo no disponible.')
        return r, resource, path

    @app.get('/api/v1/runs/{run_id}/outputs/{output_id}/preview', response_model=Preview)
    def preview(run_id: str, output_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=100)):
        import polars as pl
        with app.state.manager.lock:
            r, output, path = file_for(run_id, output_id, 'outputs')
            frame = pl.scan_ipc(path).slice(offset, min(limit, settings.preview_rows)).collect()
        rows = [[cell(v) for v in row] for row in frame.iter_rows()]
        return Preview(output_id=output_id, offset=offset, limit=min(limit, settings.preview_rows),
                       total_rows=output['rows'], columns=output['columns'], rows=rows)

    @app.get('/api/v1/runs/{run_id}/artifacts/{artifact_id}', response_class=StreamingResponse,
             responses={200: {'content': {media: {'schema': {'type': 'string', 'format': 'binary'}}
                        for media in ('application/octet-stream', 'text/csv', 'application/vnd.apache.parquet')}}})
    def artifact(run_id: str, artifact_id: str):
        # Abrir antes de liberar la exclusión de limpieza: una descarga iniciada sigue
        # leyendo su descriptor aunque el TTL elimine el nombre durante la transferencia.
        with app.state.manager.lock:
            _, resource, path = file_for(run_id, artifact_id, 'artifacts')
            handle = path.open('rb')
            size = os.fstat(handle.fileno()).st_size
        def chunks():
            try:
                while chunk := handle.read(64 * 1024):
                    yield chunk
            finally:
                handle.close()
        return StreamingResponse(chunks(), media_type=resource['media_type'], headers={
            'Content-Disposition': f"attachment; filename*=utf-8''{quote(resource['name'])}",
            'Content-Length': str(size),
        })

    @app.get('/{route:path}', include_in_schema=False)
    def static(route: str):
        # API y assets inexistentes conservan 404, nunca index.html.
        if route == 'api' or route.startswith('api/'):
            raise HTTPException(404, 'Endpoint desconocido.')
        root = settings.static.resolve()
        path = root / route
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise HTTPException(404)
        if path.is_file():
            return FileResponse(path)
        spa = '.' not in route and not route.startswith(('assets/', 'py/', 'img/'))
        if spa and (root / 'index.html').is_file():
            return FileResponse(root / 'index.html')
        raise HTTPException(404, 'Recurso no encontrado.')

    return app


app = create_app()
