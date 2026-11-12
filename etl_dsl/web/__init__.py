"""Entorno web del DSL: editor con diagnósticos, AST, IR, grafo, código y resultados."""
from .server import create_app

__all__ = ["create_app"]
