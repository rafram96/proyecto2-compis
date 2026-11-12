import assert from "node:assert/strict";
import test from "node:test";
import { createDocument, INSPECTORS, revise } from "../src/workspace/model.ts";
import {
  decode,
  STORAGE_KEY,
  writeWorkspace,
} from "../src/workspace/persistence.ts";
import {
  EXECUTION_SLUG,
  inspectorView,
  parseView,
  serializeView,
  viewHref,
  viewLabel,
  viewSlugs,
  VIEW_SLUGS,
} from "../src/workspace/view.ts";
import {
  clampSplit,
  decodeLayout,
  LAYOUT_KEY,
  readLayout,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  splitForKey,
  splitFromPointer,
  writeLayout,
} from "../src/workspace/layout.ts";

const memory = () => {
  const values = new Map();
  return {
    values,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)),
  };
};

test("?vista: nombres estables en español para los ocho inspectores y la ejecución", () => {
  assert.deepEqual(viewSlugs(), [
    "resultado",
    "tokens",
    "arbol",
    "ast",
    "flow",
    "ir",
    "esquemas",
    "python",
    "ejecucion",
  ]);
  for (const [inspector] of INSPECTORS) {
    const view = inspectorView(inspector);
    assert.deepEqual(parseView(serializeView(view)), { view, ignored: [] });
    assert.equal(viewHref(view), `/estudio?vista=${VIEW_SLUGS[inspector]}`);
  }
  assert.deepEqual(parseView(`?vista=${EXECUTION_SLUG}`).view, {
    kind: "execution",
  });
  assert.equal(viewLabel({ kind: "execution" }), "Resultados de ejecución");
  assert.equal(viewLabel(inspectorView("tree")), "Árbol");
  assert.deepEqual(parseView(""), { view: null, ignored: [] });
});

test("?vista inválida, repetida o con otros parámetros: se ignora y se informa", () => {
  for (const search of ["?vista=IR", "?vista=check", "?vista=", "?vista=..%2F", "?vista=bloques"]) {
    const parsed = parseView(search);
    assert.equal(parsed.view, null, search);
    assert.equal(parsed.ignored.length, 1, search);
    assert.match(parsed.ignored[0], /^vista=/);
  }
  assert.deepEqual(parseView("?vista=ir&vista=ast"), {
    view: null,
    ignored: ["vista repetido"],
  });
  // Un id de documento, fuente o trabajo nunca se interpreta; la vista válida se conserva.
  const extra = parseView("?vista=ir&doc=abc&source=PIPELINE&job=1");
  assert.deepEqual(extra.view, inspectorView("ir"));
  assert.deepEqual(extra.ignored, ["doc", "source", "job"]);
  const long = parseView(`?vista=${"x".repeat(200)}`);
  assert.ok(long.ignored[0].length < 60);
});

test("la serialización solo contiene la vista", () => {
  for (const slug of viewSlugs()) {
    const view = parseView(`?vista=${slug}`).view;
    const url = new URL(viewHref(view), "http://cauce.local");
    assert.deepEqual([...url.searchParams.keys()], ["vista"]);
    assert.equal(url.pathname, "/estudio");
  }
});

test("seleccionar una vista solo cambia el inspector y no crea revisión; cv1 no cambia", () => {
  const doc = createDocument("ventas.etl", "PIPELINE p {}");
  const next = revise(doc, { inspector: parseView("?vista=ir").view.inspector });
  assert.equal(next.revision, doc.revision);
  assert.deepEqual({ ...next, inspector: doc.inspector }, doc);
  const storage = memory();
  writeWorkspace(storage, { version: 1, active: next, drafts: [] });
  writeLayout(storage, 40);
  assert.equal(STORAGE_KEY, "cauce-workspace-v1");
  assert.deepEqual([...storage.values.keys()], [STORAGE_KEY, LAYOUT_KEY]);
  const stored = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(stored), ["version", "active", "drafts"]);
  assert.deepEqual(Object.keys(stored.active), [
    "id",
    "name",
    "source",
    "revision",
    "passes",
    "inspector",
  ]);
  assert.equal(decode(storage.getItem(STORAGE_KEY)).active.inspector, "ir");
  // La disposición vive en su propia clave: no aparece en el sobre v1.
  assert.ok(!storage.getItem(STORAGE_KEY).includes("editor"));
});

test("disposición: límites, puntero y teclado", () => {
  assert.equal(clampSplit(10), SPLIT_MIN);
  assert.equal(clampSplit(99), SPLIT_MAX);
  assert.equal(clampSplit(55.4), 55);
  assert.equal(clampSplit(Number.NaN), SPLIT_DEFAULT);
  // 44 px de divisor descontados: el centro del contenedor es 50 %.
  assert.equal(splitFromPointer(522, 0, 1044, 44), 50);
  assert.equal(splitFromPointer(0, 0, 1044, 44), SPLIT_MIN);
  assert.equal(splitFromPointer(5000, 0, 1044, 44), SPLIT_MAX);
  assert.equal(splitFromPointer(10, 0, 30, 44), SPLIT_DEFAULT);
  assert.equal(splitForKey(50, "ArrowLeft", false), 48);
  assert.equal(splitForKey(50, "ArrowRight", true), 60);
  assert.equal(splitForKey(31, "ArrowLeft", true), SPLIT_MIN);
  assert.equal(splitForKey(68, "ArrowUp", true), SPLIT_MAX);
  assert.equal(splitForKey(40, "Home", false), SPLIT_MIN);
  assert.equal(splitForKey(40, "End", false), SPLIT_MAX);
  assert.equal(splitForKey(64, "Enter", false), SPLIT_DEFAULT);
  assert.equal(splitForKey(50, "a", false), null);
  // Desde cualquier límite, Mayús + flechas vuelve exactamente al 50 %.
  assert.equal(splitForKey(splitForKey(SPLIT_MIN, "ArrowRight", true), "ArrowRight", true), 50);
});

test("disposición: persistencia validada y fallo de almacenamiento", () => {
  const storage = memory();
  assert.equal(readLayout(storage), SPLIT_DEFAULT);
  assert.equal(writeLayout(storage, 64), true);
  assert.equal(storage.getItem(LAYOUT_KEY), '{"version":1,"editor":64}');
  assert.equal(readLayout(storage), 64);
  for (const raw of [
    "{",
    "[]",
    "null",
    '{"version":2,"editor":50}',
    '{"version":1,"editor":"50"}',
    '{"version":1,"editor":50.5}',
    '{"version":1,"editor":10}',
    '{"version":1,"editor":90}',
  ]) {
    storage.setItem(LAYOUT_KEY, raw);
    assert.equal(readLayout(storage), SPLIT_DEFAULT, raw);
  }
  assert.throws(() => decodeLayout('{"version":1,"editor":90}'), /fuera de rango/);
  const failing = {
    getItem() {
      throw new DOMException("bloqueado", "SecurityError");
    },
    setItem() {
      throw new DOMException("cuota", "QuotaExceededError");
    },
  };
  assert.equal(readLayout(failing), SPLIT_DEFAULT);
  assert.equal(writeLayout(failing, 40), false);
  assert.equal(readLayout(undefined), SPLIT_DEFAULT);
  assert.equal(writeLayout(undefined, 40), false);
});
