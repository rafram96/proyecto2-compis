"""Tokens y posiciones de origen compartidos por las fases del compilador."""
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Span:
    line: int
    column: int
    end_line: int
    end_column: int
    start: int
    end: int


@dataclass(frozen=True, slots=True)
class Token:
    kind: str
    lexeme: str
    span: Span

    @classmethod
    def from_lark(cls, token):
        return cls(token.type, str(token), Span(
            token.line, token.column, token.end_line, token.end_column,
            token.start_pos, token.end_pos,
        ))
