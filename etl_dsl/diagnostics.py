"""Diagnósticos compartidos por sintaxis y validación estructural."""
from dataclasses import dataclass
from typing import Literal

from .token import Span


@dataclass(frozen=True, slots=True)
class Diagnostic:
    code: str
    message: str
    span: Span
    phase: Literal["lexical", "syntax", "semantic", "backend"] = "semantic"
    severity: Literal["error", "warning", "info"] = "error"

    def to_dict(self, filename: str = "<string>") -> dict:
        """Contrato JSON. Posiciones Unicode, base 1; offsets base 0 y fin exclusivo."""
        from dataclasses import asdict

        return {"code": self.code, "message": self.message, "phase": self.phase,
                "severity": self.severity, "filename": filename, "span": asdict(self.span)}

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
    token_end = getattr(getattr(exc, "token", None), "end_pos", None)
    end = pos if eof else min(len(source), max(pos + 1, token_end or pos))
    end_line = source.count("\n", 0, end) + 1
    end_column = end - source.rfind("\n", 0, end)
    span = Span(line, column, end_line, end_column, pos, end)
    phase = "lexical" if code == "E_LEXICAL" else "syntax"
    return ParseError(Diagnostic(code, message, span, phase=phase), source, filename)
