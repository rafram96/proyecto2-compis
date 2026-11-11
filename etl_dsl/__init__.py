"""Compilador ETL para Polars: sintaxis, AST, validación y generación de Python."""
from .diagnostics import Diagnostic, ParseError
from .parser import parse, parse_file, parse_tree
from .scanner import scan
from .validation import validate
from .backend import CompileError, compile_program
from .analysis import AnalysisResult, analyze
from .version import COMPILER_VERSION as __version__

__all__ = ["Diagnostic", "ParseError", "parse", "parse_file", "parse_tree", "scan", "validate",
           "CompileError", "compile_program", "AnalysisResult", "analyze", "__version__"]
