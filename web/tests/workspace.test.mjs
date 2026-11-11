import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptResult,
  createDocument,
  importText,
  isCurrent,
  MAX_SOURCE,
  pythonDownload,
  replaceDocument,
  revise,
} from "../src/workspace/model.ts";
import {
  decode,
  readWorkspace,
  STORAGE_KEY,
  writeWorkspace,
} from "../src/workspace/persistence.ts";
const initial = () => ({
  version: 1,
  active: createDocument("ventas.etl", "// 😀\nPIPELINE p {}"),
  drafts: [],
});
const compiled = (doc) => ({
  documentId: doc.id,
  revision: doc.revision,
  passes: doc.passes,
  result: {
    analysis: {
      artifacts: { python: { status: "available", data: "print('cauce')\n" } },
    },
  },
});
const memory = () => {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
};

test("revisión cambia con texto, nombre y pases; inspector conserva revisión y opciones null/[]", () => {
  const doc = initial().active;
  assert.equal(revise(doc, { inspector: "ast" }).revision, doc.revision);
  assert.equal(revise(doc, { source: doc.source }).revision, doc.revision);
  for (const change of [
    { source: "nuevo" },
    { name: "otro.etl" },
    { passes: [] },
  ])
    assert.equal(revise(doc, change).revision, doc.revision + 1);
  assert.equal(revise(doc, { inspector: "ir" }).passes, null);
  assert.deepEqual(revise(doc, { passes: [] }).passes, []);
});

test("rechaza resultados antiguos y de otro documento aunque la respuesta llegue después", () => {
  const old = initial().active,
    latest = revise(old, { source: "nuevo" });
  const result = compiled(latest);
  assert.equal(acceptResult(latest, result, compiled(old)), result);
  assert.equal(
    acceptResult(
      latest,
      result,
      compiled(createDocument("otro.etl", latest.source)),
    ),
    result,
  );
  assert.equal(isCurrent(latest, { ...result, passes: [] }), false);
  assert.equal(acceptResult(latest, null, result), result);
  assert.equal(pythonDownload(latest, compiled(old)), null);
  assert.deepEqual(pythonDownload(latest, result), {
    name: "ventas.py",
    text: "print('cauce')\n",
  });
});

test("importar y recuperar conserva los documentos anteriores sin expulsarlos al alcanzar el límite", () => {
  let workspace = initial();
  const first = workspace.active;
  for (let i = 0; i < 8; i++)
    workspace = replaceDocument(
      workspace,
      createDocument(`ejemplo${i}.etl`, `${i}`),
    );
  assert.throws(
    () => replaceDocument(workspace, createDocument("noveno.etl", "")),
    /8 borradores/,
  );
  workspace = replaceDocument(workspace, first);
  assert.deepEqual(workspace.active, first);
  assert.equal(workspace.drafts.length, 8);
});

test("persistencia versionada restaura texto exacto, revisión, inspector y O0 sin resultados", () => {
  const storage = memory();
  const workspace = replaceDocument(
    initial(),
    revise(createDocument("importado.etl", "// 😀\r\n", []), {
      inspector: "python",
    }),
  );
  workspace.result = { veryLarge: "no guardar" };
  assert.equal(writeWorkspace(storage, workspace).saved, true);
  const restored = readWorkspace(storage, initial());
  assert.deepEqual(restored.workspace.active, workspace.active);
  assert.deepEqual(restored.workspace.drafts, workspace.drafts);
  assert.equal(restored.saved, true);
  assert.equal(storage.getItem(STORAGE_KEY).includes("veryLarge"), false);
});

test("almacenamiento ausente, corrupto, incompatible, duplicado y sin cuota permite seguir editando", () => {
  const workspace = initial();
  for (const raw of [
    "{",
    '{"version":2}',
    JSON.stringify({
      ...workspace,
      active: { ...workspace.active, passes: ["desconocido"] },
    }),
    JSON.stringify({ ...workspace, drafts: [workspace.active] }),
    JSON.stringify({
      ...workspace,
      active: { ...workspace.active, revision: -1 },
    }),
  ]) {
    assert.throws(() => decode(raw));
    assert.equal(
      readWorkspace({ getItem: () => raw }, workspace).workspace,
      workspace,
    );
  }
  assert.equal(readWorkspace(undefined, workspace).saved, false);
  assert.equal(writeWorkspace(undefined, workspace).saved, false);
  assert.equal(
    writeWorkspace(
      {
        setItem() {
          throw new Error("QuotaExceededError");
        },
      },
      workspace,
    ).saved,
    false,
  );
  const changed = {
    ...workspace,
    active: revise(workspace.active, { source: "sigue editable" }),
  };
  assert.equal(writeWorkspace(memory(), changed).saved, true);
});

test("límite total no expulsa borradores ni escribe parcialmente", () => {
  const storage = memory();
  let workspace = initial();
  writeWorkspace(storage, workspace);
  const before = storage.getItem(STORAGE_KEY);
  for (let i = 0; i < 5; i++)
    workspace = replaceDocument(
      workspace,
      createDocument(`${i}.etl`, "x".repeat(MAX_SOURCE)),
    );
  assert.equal(writeWorkspace(storage, workspace).saved, false);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  assert.equal(workspace.drafts.length, 5);
});

test("importación UTF-8 real conserva contenido y nombre lógico, valida extensión y tamaño en bytes", () => {
  const text =
    "// café 😀\r\nPIPELINE p { INPUT i: TABLE; OUTPUT o: TABLE; FLOW { i -> o; } }\n";
  const doc = importText("carpeta/programa.etl", text);
  assert.equal(doc.source, text);
  assert.equal(doc.name, "programa.etl");
  assert.equal(importText("bom.etl", `\uFEFF${text}`).source, text);
  assert.throws(() => importText("datos.csv", text), /archivo .etl/);
  assert.throws(
    () => importText("grande.etl", "😀".repeat(MAX_SOURCE / 2)),
    /128 KiB/,
  );
});
