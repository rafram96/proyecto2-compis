"""Diagnósticos compartidos por sintaxis y validación estructural."""
from dataclasses import dataclass

from .token import Span


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: str
    message: str
    span: Span

    def format(self, source: str, filename: str = "<string>") -> str:
        lines = source.splitlines()
        line = lines[self.span.line - 1] if self.span.line <= len(lines) else ""
        marker = " " * (self.span.column - 1) + "^"
        return (f"{filename}:{self.span.line}:{self.span.column}: "
                f"{self.code}: {self.message}\n{line}\n{marker}")


class ParseError(ValueError):
    def __init__(self, diagnostic: Diagnostic, source: str, filename: str):
        self.diagnostic = diagnostic
        self.source = source
        self.filename = filename
        super().__init__(diagnostic.format(source, filename))


def unexpected_input(exc, source: str, filename: str, *, code="E_SYNTAX") -> ParseError:
    """Normaliza errores de Lark para el scanner y el parser."""
    eof = getattr(getattr(exc, "token", None), "type", None) == "$END"
    pos = len(source) if eof else max(0, exc.pos_in_stream)
    line = source.count("\n", 0, pos) + 1
    column = pos - source.rfind("\n", 0, pos)
    expected = sorted(getattr(exc, "expected", None) or getattr(exc, "allowed", None) or ())
    message = "Fin de archivo inesperado" if eof else "Símbolo inesperado"
    if expected:
        message += "; se esperaba: " + ", ".join(expected)
    span = Span(line, column, line, column + 1, pos, pos)
    return ParseError(Diagnostic(code, message, span), source, filename)
