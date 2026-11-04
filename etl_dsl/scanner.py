"""Scanner de Lark y configuración compartida de la gramática.

scan expone la tokenización básica para inspección léxica. Durante el parsing,
Lark usa su lexer contextual para resolver palabras clave según el estado LALR.
"""
from functools import lru_cache

from lark import Lark, UnexpectedInput

from .diagnostics import unexpected_input
from .token import Token


@lru_cache(maxsize=1)
def get_lark() -> Lark:
    return Lark.open_from_package("etl_dsl", "grammar.lark", parser="lalr",
                                  lexer="contextual", propagate_positions=True,
                                  maybe_placeholders=False)


def scan(source: str, *, filename: str = "<string>") -> tuple[Token, ...]:
    """Reconoce tokens sin validar sintaxis. Omite espacios y comentarios."""
    try:
        return tuple(Token.from_lark(token) for token in get_lark().lex(source))
    except UnexpectedInput as exc:
        raise unexpected_input(exc, source, filename, code="E_LEXICAL") from exc
