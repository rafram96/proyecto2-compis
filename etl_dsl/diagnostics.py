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


MAX_EXPECTED = 12


def unexpected_input(exc, source: str, filename: str, *, code="E_SYNTAX", describe=str) -> ParseError:
    """Normaliza errores de Lark para el scanner y el parser.

    `describe` traduce el nombre de un terminal de Lark (SEMICOLON) a cómo se
    escribe en el programa (";").
    """
    eof = getattr(getattr(exc, "token", None), "type", None) == "$END"
    pos = len(source) if eof else max(0, exc.pos_in_stream)
    line = source.count("\n", 0, pos) + 1
    column = pos - source.rfind("\n", 0, pos)
    expected = sorted({describe(name) for name in
                       getattr(exc, "expected", None) or getattr(exc, "allowed", None) or ()})
    if eof:
        message = "Fin de archivo inesperado"
    elif code == "E_LEXICAL":
        message = f"Carácter inesperado: {source[pos]!r}"
    else:
        message = f'Símbolo inesperado: "{getattr(exc, "token", "")!s}"'
    # Una lista larga (p. ej., cualquier token) no orienta a quien escribe el programa.
    if 0 < len(expected) <= MAX_EXPECTED:
        message += "; se esperaba: " + ", ".join(expected)
    span = Span(line, column, line, column + 1, pos, pos + 1)
    return ParseError(Diagnostic(code, message, span), source, filename)
