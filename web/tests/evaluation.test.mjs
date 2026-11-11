import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  catalog,
  defaultSelection,
  parseSelection,
  serializeSelection,
  rowsFor,
  reading,
  transforms,
  ticks,
  ms,
  ratio,
  rowsLabel,
} from "../src/evaluation/model.ts";

const data = JSON.parse(
  readFileSync(new URL("../src/evaluation/generated.json", import.meta.url)),
);
const c = catalog(data);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

test("cada celda publicada recalcula mediana, IQR, extremos y razón con su propio O0", () => {
  assert.equal(data.cells.length, 440);
  for (const cell of data.cells) {
    assert.equal(cell.samples.length, cell.n);
    assert.equal(cell.median, median(cell.samples));
    assert.equal(cell.iqr, percentile(cell.samples, 0.75) - percentile(cell.samples, 0.25));
    assert.equal(cell.min, Math.min(...cell.samples));
    assert.equal(cell.max, Math.max(...cell.samples));
    const o0 = data.cells.find(
      (o) =>
        o.configuration === "O0" &&
        o.phase === cell.phase &&
        o.workload === cell.workload &&
        o.size === cell.size &&
        o.scenario === cell.scenario,
    );
    assert.equal(cell.ratio, o0.median / cell.median);
  }
});

test("compilación sin tamaño ni escenario y sin baseline manual", () => {
  const compile = data.cells.filter((cell) => cell.phase === "compile");
  assert.equal(compile.length, 56);
  assert.ok(compile.every((cell) => cell.size === 0 && cell.scenario === "not_applicable"));
  assert.ok(!compile.some((cell) => cell.configuration === "manual"));
  const { selection } = parseSelection(
    "?fase=compilacion&workload=join&filas=200000&escenario=final_flags_none&config=O0,default,manual",
    c,
  );
  assert.deepEqual(selection.configurations, ["O0", "default"]);
  const { rows } = rowsFor(data.cells, selection, c);
  assert.ok(rows.every((row) => row.size === 0 && row.scenario === "not_applicable"));
  assert.equal(serializeSelection(selection, c), "?fase=compilacion&workload=join&config=O0%2Cdefault");
});

test("parámetros válidos se restauran y los inválidos vuelven al valor por defecto con aviso", () => {
  const search = "?fase=ejecucion&workload=join&filas=1000000&escenario=final_flags_none&config=O0%2Cjoins%2Cmanual";
  const { selection, ignored } = parseSelection(search, c);
  assert.deepEqual(ignored, []);
  assert.deepEqual(selection, {
    phase: "execute",
    workload: "join",
    size: 1000000,
    scenario: "final_flags_none",
    configurations: ["O0", "joins", "manual"],
  });
  assert.equal(serializeSelection(selection, c), search);
  const bad = parseSelection("?fase=x&workload=..%2F&filas=5&escenario=sin_optimizar&config=O9&otro=1", c);
  assert.deepEqual(bad.selection, defaultSelection(c));
  assert.deepEqual(bad.ignored.sort(), ["config", "escenario", "fase", "filas", "otro", "workload"]);
  // O0 siempre queda como referencia de la razón.
  assert.deepEqual(parseSelection("?config=default", c).selection.configurations, ["O0", "default"]);
  assert.deepEqual(parseSelection("?filas=1e6", c).ignored, ["filas"]);
});

test("escenarios separados: cada uno tiene su propio O0", () => {
  const base = { phase: "execute", workload: "join", size: 1000000, configurations: ["O0", "default"] };
  const normal = rowsFor(data.cells, { ...base, scenario: "normal" }, c);
  const none = rowsFor(data.cells, { ...base, scenario: "final_flags_none" }, c);
  assert.notEqual(normal.reference.median, none.reference.median);
  assert.equal(none.rows[1].ratio, none.reference.median / none.rows[1].median);
  assert.ok(normal.rows.every((r) => r.scenario === "normal"));
});

test("lectura: mejora observada, sin mejora y variación sin reescritura", () => {
  const pick = (workload, configuration) => {
    const sel = { phase: "execute", workload, size: 1000000, scenario: "normal", configurations: ["O0", configuration] };
    const { rows, reference } = rowsFor(data.cells, sel, c);
    return reading(rows[1], reference, transforms(data.structure, workload, configuration)).key;
  };
  assert.equal(pick("join", "default"), "faster");
  assert.equal(pick("rangos", "default"), "within");
  assert.equal(pick("agregados", "default"), "no-rewrite");
  assert.equal(pick("control_join", "joins"), "no-rewrite");
  assert.equal(transforms(data.structure, "join", "manual"), null);
});

test("formatos y escala lineal desde cero", () => {
  assert.equal(rowsLabel(1000000), "1 000 000");
  assert.equal(ms(12.43851), "12.4385");
  assert.equal(ratio(4.40012), "4.400");
  const t = ticks(13.7);
  assert.equal(t.values[0], 0);
  assert.ok(t.top >= 13.7);
  assert.ok(t.values.length <= 6);
});

test("descargas: cada archivo declara hash publicado y original; solo metadata está depurado", () => {
  const files = data.downloads.files;
  assert.equal(files.length, 7);
  for (const file of files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(file.identical_to_original, file.sha256 === file.original.sha256);
  }
  assert.deepEqual(
    files.filter((f) => !f.identical_to_original).map((f) => f.path),
    ["metadata.public.json"],
  );
  assert.match(data.downloads.manifest.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(data).includes("/Users/"));
});
