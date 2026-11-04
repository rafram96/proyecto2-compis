"""Análisis sintáctico LALR y API del frontend."""
from pathlib import Path

from lark import UnexpectedInput

from . import ast as a
from .diagnostics import ParseError, unexpected_input
from .scanner import get_lark
from .visitor import ASTBuilder


def parse_tree(source: str, *, filename: str = "<string>"):
    """Devuelve el árbol concreto de Lark; no realiza comprobaciones semánticas."""
    try:
        return get_lark().parse(source)
    except UnexpectedInput as exc:
        raise unexpected_input(exc, source, filename) from exc


def parse(source: str, *, filename: str = "<string>") -> a.Program:
    """Analiza sintaxis y devuelve un AST tipado, aun si contiene errores semánticos."""
    return ASTBuilder().transform(parse_tree(source, filename=filename))


def parse_file(path: str | Path) -> a.Program:
    path = Path(path)
    return parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
