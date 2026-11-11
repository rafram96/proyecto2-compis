import assert from "node:assert/strict";
import test from "node:test";
import { editorDiagnostics } from "../src/compiler/diagnostics.ts";

function diagnostic(line, column, endLine, endColumn) {
  return {
    code: "E_NULL_COMPARISON", message: "Use IS NULL.", filename: "C:/virtual/demo.etl",
    phase: "semantic", severity: "error",
    span: { line, column, end_line: endLine, end_column: endColumn, start: 0, end: 0 },
  };
}

test("subraya la expresión completa después de un emoji sin desplazar el rango", () => {
  const source = 'WHERE "😀" == "é" AND x == NULL;';
  const prefix = 'WHERE "😀" == "é" AND ';
  const column = Array.from(prefix).length + 1;
  const [marker] = editorDiagnostics(source, [diagnostic(1, column, 1, column + "x == NULL".length)]);
  assert.equal(source.slice(marker.from, marker.to), "x == NULL");
  assert.equal(marker.from, prefix.length);
  assert.equal(marker.message, "E_NULL_COMPARISON: Use IS NULL.");
});

test("conserva el rango de una expresión en varias líneas", () => {
  const source = "FILTER { WHERE x\n == NULL; }";
  const [marker] = editorDiagnostics(source, [diagnostic(1, 16, 2, 9)]);
  assert.equal(source.slice(marker.from, marker.to), "x\n == NULL");
});

test("admite diagnóstico vacío al final del documento", () => {
  const source = "PIPELINE p {\n";
  const [marker] = editorDiagnostics(source, [diagnostic(2, 1, 2, 1)]);
  assert.equal(marker.from, source.length);
  assert.equal(marker.to, source.length);
});

test("ignora líneas fuera del documento y acota columnas sin inventar texto", () => {
  const source = "abc";
  const markers = editorDiagnostics(source, [diagnostic(0, 1, 0, 2), diagnostic(2, 1, 2, 2), diagnostic(1, 99, 1, 100)]);
  assert.equal(markers.length, 1);
  assert.deepEqual([markers[0].from, markers[0].to], [3, 3]);
});
