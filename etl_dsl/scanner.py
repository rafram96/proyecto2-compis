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


READABLE = {"NAME": "nombre", "NUMBER": "número", "STRING": "texto entre comillas",
            "BASE_TYPE": "tipo (INT, DECIMAL…)", "JOIN_KIND": "INNER, LEFT, RIGHT o FULL",
            "SORT_DIRECTION": "ASC o DESC", "AGG_FUNC": "COUNT, SUM, AVG, MIN o MAX",
            "SCALAR_FUNC": "función", "COMP_OP": "comparación", "ADD_OP": "+ o -", "MUL_OP": "* o /"}


@lru_cache(maxsize=None)
def describe_terminal(name: str) -> str:
    """Cómo se escribe un terminal: el literal para los fijos (";", "FILTER"), una descripción para el resto."""
    if name in READABLE:
        return READABLE[name]
    try:
        pattern = get_lark().get_terminal(name).pattern
    except KeyError:
        return name
    return f'"{pattern.value}"' if pattern.type == "str" else name


def scan(source: str, *, filename: str = "<string>") -> tuple[Token, ...]:
    """Reconoce tokens sin validar sintaxis. Omite espacios y comentarios."""
    try:
        return tuple(Token.from_lark(token) for token in get_lark().lex(source))
    except UnexpectedInput as exc:
        raise unexpected_input(exc, source, filename, code="E_LEXICAL", describe=describe_terminal) from exc
