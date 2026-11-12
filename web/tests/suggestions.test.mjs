import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  basisNote,
  closestColumns,
  columnFix,
  cursorContext,
  inputColumns,
  nextBasis,
  suggest,
  usableAnalysis,
} from "../src/editor/suggestions.ts";
import { AGGREGATE_ARITY, CONNECTOR_SPECS, SCALAR_ARITY } from "../src/editor/words.ts";

// Análisis reales: el mismo puente (web/src/compiler/studio.py) que usa el worker de Pyodide, con todos los artefactos.
const root = new URL("../..", import.meta.url);
function bridge(sources) {
  const run = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      `
import json, sys
sys.path.insert(0, 'web/src/compiler')
from studio import compile_etl
sources = json.load(sys.stdin)
print(json.dumps({key: compile_etl(text, key + '.etl', all_artifacts=True)['analysis'] for key, text in sources.items()}))
`,
    ],
    { cwd: root, input: JSON.stringify(sources), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.error || run.status !== 0) throw new Error(run.error?.message || run.stderr);
  return JSON.parse(run.stdout);
}
const read = (path) => readFileSync(new URL(path, root), "utf8");
const src = {
  tutorial: read("demo/tutorial.etl"),
  risk: read("input/credit_risk.etl"),
  duckdb: read("input/duckdb.etl"),
};
src.columnError = src.tutorial.replace("WHERE importe > 0;", "WHERE importes > 0;");
src.joinError = src.risk.replace("left.customer_id ==", "left.customer_idd ==");
src.syntaxError = src.tutorial.replace("WHERE importe > 0;", "WHERE importe >");
src.newStep = src.tutorial
  .replace("STEP ranking = SORT", "STEP extra = FILTER {\n        WHERE total > 0;\n    }\n\n    STEP ranking = SORT")
  .replace("por_cliente -> ranking", "por_cliente -> extra -> ranking");
const analyses = bridge(src);
const basis = (key, revision = 1, documentId = "doc") => ({
  documentId,
  revision,
  source: src[key],
  analysis: analyses[key],
});

/** Inserta `insert` justo después de `marker` y sugiere en ese punto. */
function at(key, marker, insert = "", base = basis(key), explicit = true) {
  const index = src[key].indexOf(marker);
  assert.ok(index >= 0, `marcador ausente: ${marker}`);
  const pos = index + marker.length;
  const text = src[key].slice(0, pos) + insert + src[key].slice(pos);
  return suggest(text, pos + insert.length, base, explicit);
}
const labels = (result) => result?.options.map((o) => o.label) ?? [];
const columnNames = (key, step, side = null) =>
  inputColumns(basis(key), key === "tutorial" ? "gasto_por_cliente" : "order_report", step, side)?.columns.map((c) => c.name);

test("los análisis de referencia son válidos y los erróneos no sirven de base", () => {
  for (const key of ["tutorial", "risk", "duckdb", "newStep"]) assert.ok(usableAnalysis(analyses[key]), key);
  for (const key of ["columnError", "joinError", "syntaxError"]) {
    assert.equal(analyses[key].ok, false, key);
    assert.equal(usableAnalysis(analyses[key]), false, key);
  }
  assert.equal(analyses.columnError.diagnostics[0].code, "E_COLUMN");
  assert.equal(analyses.syntaxError.artifacts.ast.status, "blocked");
});

test("esquema completo: columnas de la entrada de cada STEP desde schemas e ir_before", () => {
  const where = at("tutorial", "WHERE ");
  assert.deepEqual(labels(where).slice(0, 2), ["cliente", "importe"]);
  assert.equal(where.options[0].detail, "INT · sin NULL");
  assert.match(where.options[0].section.title, /Columnas de pedidos$/);
  assert.equal(where.options[0].section.note, "Análisis vigente · revisión 1");
  assert.match(where.options[1].info, /Esquema completo/);
  // Funciones escalares con su aridad dentro de expresiones.
  const coalesce = where.options.find((o) => o.label === "COALESCE");
  assert.equal(coalesce.detail, "2 o más argumentos");
  assert.equal(coalesce.insert, "COALESCE()");
  // La entrada de por_cliente es con_igv: incluye la columna derivada, y no las posteriores.
  assert.deepEqual(labels(at("tutorial", "SUM(")).slice(0, 3), ["cliente", "importe", "importe_con_igv"]);
  assert.deepEqual(
    labels(at("tutorial", "BY total DESC;", "", basis("tutorial"))),
    [],
    "tras una clave y su dirección no se ofrecen columnas",
  );
  const sortKeys = at("tutorial", "STEP ranking = SORT {\n        BY ");
  assert.deepEqual(labels(sortKeys), ["cliente", "pedidos", "total", "total_con_igv"]);
  // Las columnas ya listadas no se repiten; las agregaciones solo al iniciar una línea de AGGREGATE.
  assert.deepEqual(labels(at("tutorial", "GROUP_BY cliente", ", ")), ["importe", "importe_con_igv"]);
  const aggregates = at("tutorial", "GROUP_BY cliente;\n");
  assert.deepEqual(labels(aggregates), ["COUNT", "SUM", "AVG", "MIN", "MAX"]);
  assert.equal(aggregates.options[0].detail, "0 o 1 argumento");
  assert.equal(aggregates.options[0].reopen, false);
  assert.equal(aggregates.options[1].reopen, true);
  // DERIVE: el nombre nuevo no recibe columnas; la expresión sí.
  assert.equal(at("tutorial", "STEP con_igv = DERIVE {\n        "), null);
  assert.ok(labels(at("tutorial", "importe_con_igv = ")).includes("importe"));
});

test("esquema parcial: solo columnas conocidas, avisado en sección, detalle y sin inventar", () => {
  // SQLITE sin contrato: FILL_NULL debt = 0 solo da a conocer debt.
  const partial = at("risk", "STEP valid = FILTER {\n        WHERE ");
  const columns = partial.options.filter((o) => o.type === "variable");
  assert.deepEqual(columns.map((o) => o.label), ["debt"]);
  assert.match(columns[0].section.title, /Columnas de cleaned · esquema parcial/);
  assert.match(columns[0].info, /Esquema parcial: solo se listan las columnas conocidas/);
  assert.equal(columns[0].detail, "tipo desconocido · sin NULL");
  // RENAME sobre customers (SOURCE sin contrato): ninguna columna conocida, solo el aviso.
  const none = at("risk", "id AS customer_key;", "\n");
  assert.deepEqual(none.options, []);
  assert.match(none.notice, /Sin columnas conocidas de customers: esquema parcial/);
  assert.deepEqual(columnNames("risk", "customer_keys"), []);
});

test("JOIN: left./right. solo dentro de ON y columnas de cada lado", () => {
  const qualifiers = at("risk", "ON ");
  assert.deepEqual(labels(qualifiers), ["left.", "right."]);
  assert.ok(qualifiers.options.every((o) => o.reopen));
  assert.equal(qualifiers.exclusive, true);
  const left = at("risk", "ON left.", "", basis("risk"), false);
  assert.equal(left.exclusive, true);
  assert.deepEqual(labels(left), ["id", "customer_id", "amount", "status"]);
  assert.match(left.options[0].section.title, /^Columnas de left · clean\.cleaned$/);
  const right = at("risk", "== right.", "", basis("risk"), false);
  assert.deepEqual(labels(right), ["customer_key"]);
  assert.match(right.options[0].section.title, /esquema parcial/);
  // Fuera de ON no hay calificadores ni columnas calificadas.
  assert.ok(!labels(at("tutorial", "WHERE ")).includes("left."));
  assert.equal(at("tutorial", "WHERE ", "left."), null);
  assert.equal(at("risk", "TYPE LEFT;", " "), null);
});

test("FLOW: productores y destinos con puertos de JOIN y de cada USE", () => {
  const consumers = at("risk", "raw_orders -> ", "", basis("risk"), false);
  assert.equal(consumers, null, "sin palabra ni Ctrl+Espacio no se abre sola");
  const destinations = at("risk", "raw_orders -> ");
  assert.equal(destinations.exclusive, true);
  assert.deepEqual(labels(destinations).sort(), [
    "clean.orders",
    "customer_keys",
    "joined.left",
    "joined.right",
    "output",
    "selected",
  ]);
  const producers = at("risk", "        joined -> selected -> output;\n", "");
  assert.deepEqual(labels(producers).sort(), [
    "clean.cleaned",
    "customer_keys",
    "customers",
    "joined",
    "raw_orders",
    "selected",
  ]);
  assert.equal(producers.options.find((o) => o.label === "raw_orders").detail, "SOURCE · CSV");
  assert.deepEqual(labels(at("risk", "        clean.", "", basis("risk"), false)), ["cleaned"]);
  assert.deepEqual(labels(at("risk", "raw_orders -> clean.", "", basis("risk"), false)), ["orders"]);
  assert.deepEqual(labels(at("risk", "-> joined.", "", basis("risk"), false)), ["left", "right"]);
  // Pipeline sin USE: SINK nunca es productor.
  assert.ok(!labels(at("risk", "    FLOW {\n        ")).includes("output"));
});

test("USE: pipelines del programa con sus INPUT/OUTPUT, sin el propio", () => {
  const pipes = at("risk", "USE ");
  assert.deepEqual(labels(pipes), ["credit_risk", "clean_orders"]);
  assert.equal(pipes.options[1].detail, "INPUT orders · OUTPUT cleaned");
});

test("conectores y opciones dependen de SOURCE/SINK", () => {
  assert.deepEqual(labels(at("risk", "SOURCE raw_orders = ")), ["CSV", "PARQUET", "DUCKDB", "SQLITE"]);
  assert.deepEqual(labels(at("risk", "SINK output = ")), ["CSV", "PARQUET", "DUCKDB"]);
  const csv = at("risk", "SOURCE raw_orders = CSV(", "", basis("risk"), false);
  assert.deepEqual(labels(csv), ["file", "header", "delimiter", "nullstr"]);
  assert.equal(csv.options[0].insert, 'file: ""');
  assert.equal(csv.options[1].insert, "header: ");
  assert.deepEqual(labels(at("risk", 'CSV(file: "orders.csv"', ", ")), ["header", "delimiter", "nullstr"]);
  assert.deepEqual(labels(at("duckdb", 'DUCKDB(file: "ventas.duckdb", table: "ventas"', ", ")), ["schema"]);
  const sink = src.duckdb.replace('PARQUET(file: "out/ventas_por_cliente.parquet")', 'DUCKDB(file: "o.duckdb", ');
  const pos = sink.indexOf('DUCKDB(file: "o.duckdb", ') + 'DUCKDB(file: "o.duckdb", '.length;
  assert.deepEqual(labels(suggest(sink, pos, null, true)), ["table", "schema", "mode"]);
  // Cadenas y comentarios no reciben sugerencias.
  assert.equal(at("risk", 'CSV(file: "orde'), null);
  assert.equal(at("risk", "// Main ETL"), null);
});

test("conectores, opciones y aridad coinciden con el compilador real", () => {
  const value = (option) =>
    option.name === "header" ? "TRUE" : option.name === "mode" ? '"replace"' : option.name === "delimiter" ? '";"' : '"x"';
  const cases = {};
  const expected = {};
  for (const [name, spec] of Object.entries(CONNECTOR_SPECS))
    for (const role of ["SOURCE", "SINK"]) {
      const options = spec.options.filter((o) => role === "SINK" || !o.sinkOnly);
      const required = options.filter((o) => o.required);
      for (const extra of [null, ...options.filter((o) => !o.required)]) {
        const args = [...required, ...(extra ? [extra] : [])].map((o) => `${o.name}: ${value(o)}`).join(", ");
        const key = `${name}_${role}_${extra?.name ?? "base"}`;
        cases[key] =
          role === "SOURCE"
            ? `PIPELINE p { SOURCE s = ${name}(${args}); OUTPUT o: TABLE; FLOW { s -> o; } }`
            : `PIPELINE p { INPUT i: TABLE[x: INT]; SINK s = ${name}(${args}); FLOW { i -> s; } }`;
        expected[key] = role === "SOURCE" || spec.sink;
      }
      // Opciones que no se sugieren: mode en SOURCE y nombres ajenos.
      cases[`${name}_${role}_ajena`] = `PIPELINE p { SOURCE s = ${name}(${required.map((o) => `${o.name}: ${value(o)}`).join(", ")}, ajena: "x"); OUTPUT o: TABLE; FLOW { s -> o; } }`;
      expected[`${name}_${role}_ajena`] = false;
    }
  cases.DUCKDB_SOURCE_mode = 'PIPELINE p { SOURCE s = DUCKDB(file: "x", table: "t", mode: "replace"); OUTPUT o: TABLE; FLOW { s -> o; } }';
  expected.DUCKDB_SOURCE_mode = false;
  // SAFE_DIVIDE exige números; el resto acepta la columna de texto.
  const call = (fn, n) => Array.from({ length: n }, () => (fn === "SAFE_DIVIDE" ? "n" : "x")).join(", ");
  for (const [fn, { min, max }] of Object.entries(SCALAR_ARITY)) {
    const counts = [min, max ?? min + 3, min - 1, ...(max === null ? [] : [max + 1])];
    counts.forEach((n, i) => {
      if (n < 0) return;
      const key = `scalar_${fn}_${n}`;
      cases[key] = `PIPELINE p { INPUT i: TABLE[x: STRING, n: INT]; STEP d = DERIVE { y = ${fn}(${call(fn, n)}); } OUTPUT o: TABLE; FLOW { i -> d -> o; } }`;
      expected[key] = i < 2;
    });
  }
  for (const [fn, { min, max }] of Object.entries(AGGREGATE_ARITY))
    for (const n of [min, max, min - 1, max + 1]) {
      if (n < 0) continue;
      const key = `aggregate_${fn}_${n}`;
      cases[key] = `PIPELINE p { INPUT i: TABLE[x: INT]; STEP a = AGGREGATE { ${fn}(${call(fn, n)}) AS t; } OUTPUT o: TABLE; FLOW { i -> a -> o; } }`;
      expected[key] = n >= min && n <= max;
    }
  const results = bridge(cases);
  for (const [key, ok] of Object.entries(expected)) {
    const codes = results[key].diagnostics.map((d) => d.code);
    if (ok) assert.equal(results[key].ok, true, `${key}: ${codes}`);
    else assert.equal(results[key].ok, false, `${key} debería fallar`);
    if (!ok && /^(CSV|PARQUET|DUCKDB|SQLITE)_/.test(key)) assert.ok(codes.includes("E_CONNECTOR"), `${key}: ${codes}`);
    if (!ok && key.startsWith("scalar_")) assert.ok(codes.includes("E_ARITY"), `${key}: ${codes}`);
  }
  // SQLITE no es destino.
  assert.equal(expected.SQLITE_SINK_base, false);
});

test("análisis obsoleto o con errores: se conserva el último válido y se marca", () => {
  const valid = basis("tutorial", 4);
  const kept = nextBasis(valid, { ...basis("columnError", 5) });
  assert.equal(kept, valid, "un análisis con E_COLUMN no sustituye la base");
  assert.equal(nextBasis(valid, basis("syntaxError", 6)), valid, "ni uno sin AST");
  assert.equal(nextBasis(null, basis("syntaxError", 1)), null);
  assert.equal(nextBasis(valid, basis("syntaxError", 1, "otro")), null, "otro documento descarta la base");
  assert.equal(nextBasis(valid, basis("newStep", 7)).revision, 7);
  assert.equal(nextBasis(basis("newStep", 8), basis("tutorial", 7)).revision, 8, "nunca retrocede");
  // Texto con error de sintaxis (como al escribir): columnas de la revisión 4, marcadas como último análisis válido.
  const typing = src.tutorial.replace("WHERE importe > 0;", "WHERE imp");
  const pos = typing.indexOf("WHERE imp") + "WHERE imp".length;
  const result = suggest(typing, pos, kept, false);
  assert.deepEqual(result.options.filter((o) => o.type === "variable").map((o) => o.label), ["cliente", "importe"]);
  assert.equal(result.options[0].section.note, "Último análisis válido · revisión 4; el texto cambió después");
  assert.match(result.options[0].info, /el texto cambió después/);
  assert.equal(basisNote(kept, src.tutorial.replace(/\n/g, "\r\n")).current, true, "CRLF importado sin editar es el mismo texto");
  // Un STEP nuevo que la base no conoce no recibe columnas supuestas.
  const pos2 = src.newStep.indexOf("WHERE total") + "WHERE ".length;
  const unknown = suggest(src.newStep, pos2, valid, true);
  assert.deepEqual(unknown.options.filter((o) => o.type === "variable"), []);
  assert.match(unknown.notice, /extra no tiene entrada en el último análisis válido \(revisión 4\)/);
  // Tras compilar sin errores, el STEP nuevo ya tiene columnas.
  const fresh = suggest(src.newStep, pos2, basis("newStep", 9), true);
  assert.deepEqual(fresh.options.filter((o) => o.type === "variable").map((o) => o.label), ["cliente", "pedidos", "total", "total_con_igv"]);
  // Sin ninguna base: nada del programa, solo funciones y el aviso.
  const blind = suggest(typing, pos, null, true);
  assert.deepEqual(blind.options.filter((o) => o.type === "variable"), []);
  assert.match(blind.notice, /compila sin errores/);
});

test("¿quisiste decir? sobre el intervalo exacto de E_COLUMN, sin cambiar el diagnóstico", () => {
  const valid = basis("tutorial", 1);
  const [diagnostic] = analyses.columnError.diagnostics;
  const message = diagnostic.message;
  const fix = columnFix(src.columnError, diagnostic, valid);
  assert.deepEqual(fix.replacements, ["importe"]);
  assert.equal(src.columnError.slice(fix.from, fix.to), "importes");
  assert.equal(fix.expected, "importes");
  assert.equal(diagnostic.message, message);
  const corrected = src.columnError.slice(0, fix.from) + fix.replacements[0] + src.columnError.slice(fix.to);
  assert.equal(corrected, src.tutorial);
  // JOIN: conserva el calificador y busca en el lado correcto.
  const joinDiagnostic = analyses.joinError.diagnostics.find((d) => d.code === "E_COLUMN");
  const joinFix = columnFix(src.joinError, joinDiagnostic, basis("risk"));
  assert.equal(joinFix.expected, "left.customer_idd");
  assert.deepEqual(joinFix.replacements, ["left.customer_id"]);
  // Sin base válida u otros códigos: ninguna acción.
  assert.equal(columnFix(src.columnError, diagnostic, null), null);
  assert.equal(columnFix(src.columnError, { ...diagnostic, code: "E_TYPE" }, valid), null);
  // Lo corregido compila sin errores en el núcleo.
  assert.equal(bridge({ corrected }).corrected.ok, true);
  assert.deepEqual(closestColumns("Importe", ["importe", "importes"]), ["importe"]);
  assert.deepEqual(closestColumns("zzz", ["importe"]), []);
  assert.deepEqual(closestColumns("tota", ["total", "totas"]), ["total", "totas"]);
});

test("pedir sugerencias no compila: el módulo y el editor no importan el cliente del compilador", () => {
  for (const file of ["../src/editor/suggestions.ts", "../src/editor/etl.ts", "../src/editor/words.ts"]) {
    const code = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(code, /compiler\/(client|runtime|worker)|postMessage|\bcompile\(/, file);
  }
  // `suggest` es síncrono y no modifica la base.
  const base = basis("tutorial");
  const frozen = JSON.stringify(base);
  const result = at("tutorial", "WHERE ", "", base);
  assert.ok(!(result instanceof Promise));
  assert.equal(JSON.stringify(base), frozen);
});

test("contexto léxico: dónde está el cursor, no qué es válido", () => {
  const text = "PIPELINE p {\n  STEP s = FILTER {\n    WHERE (a + ";
  assert.deepEqual(cursorContext(text, text.length), {
    kind: "columns",
    pipeline: "p",
    step: "s",
    side: null,
    exclude: [],
    functions: true,
  });
  assert.equal(cursorContext("PIPELINE p {\n  STEP s = FILTER { WHERE x; }\n  ", 44), null);
  assert.equal(cursorContext('PIPELINE p { SOURCE s = CSV(file: "a', 36), null);
  assert.equal(cursorContext("STEP s = FILTER { WHERE ", 24), null, "fuera de un PIPELINE");
});
