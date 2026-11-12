"""Servidor del entorno web: la API JSON del compilador y la página del editor."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import api

STATIC = Path(__file__).with_name("static")
MAX_SOURCE = 200_000  # caracteres


class Program(BaseModel):
    source: str = Field(max_length=MAX_SOURCE)
    passes: list[str] | None = None  # None: pases por defecto; []: -O0


def create_app(data_dir: str | Path = "input", example_dirs=None) -> FastAPI:
    """Crea la aplicación.

    `data_dir` es la base de las rutas relativas de SOURCE y SINK y la única
    carpeta que los programas pueden leer o escribir. Los ejemplos son los
    .etl de `example_dirs` (por defecto, `data_dir` y `./demo`).
    """
    data_dir = Path(data_dir).resolve()
    folders = [Path(d).resolve() for d in (example_dirs or [data_dir, Path("demo")])]

    def examples() -> dict[str, Path]:
        return {f"{folder.name}/{path.name}": path
                for folder in folders if folder.is_dir() for path in sorted(folder.glob("*.etl"))}

    def passes(program: Program) -> tuple[str, ...]:
        try:
            return api.resolve_passes(program.passes)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    app = FastAPI(title="Entorno DSL ETL", docs_url="/api/docs", redoc_url=None)

    @app.get("/api/examples")
    def list_examples() -> list[str]:
        return list(examples())

    @app.get("/api/examples/{name:path}")
    def read_example(name: str) -> dict:
        path = examples().get(name)
        if path is None:
            raise HTTPException(status_code=404, detail=f"Ejemplo desconocido: {name}")
        return {"name": name, "source": path.read_text(encoding="utf-8-sig")}

    @app.post("/api/compile")
    def compile_program(program: Program) -> dict:
        return api.compile_source(program.source, passes(program), base_dir=data_dir)

    @app.post("/api/run")
    def run_program(program: Program) -> dict:
        return api.run_source(program.source, passes(program), base_dir=data_dir, root=data_dir)

    app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
    return app
