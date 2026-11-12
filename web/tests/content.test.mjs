import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { markdown } from "../src/content/markdown.ts";
import {
  createDocument,
  replaceDocument,
  revise,
} from "../src/workspace/model.ts";
import { writeWorkspace, decode } from "../src/workspace/persistence.ts";
const content = JSON.parse(
  readFileSync(new URL("../src/content/generated.json", import.meta.url)),
);

test("catálogo enlaza solo slugs explícitos y artículos con anclas únicas", () => {
  const examples = new Set(content.examples.map((e) => e.slug));
  const articles = new Set(content.articles.map((a) => a.slug));
  for (const example of content.examples)
    for (const slug of example.docs) assert.ok(articles.has(slug));
  for (const article of content.articles) {
    assert.ok(examples.has(article.program));
    for (const slug of article.examples) assert.ok(examples.has(slug));
    const headings = markdown(article.body)
      .filter((b) => b.kind === "heading")
      .map((b) => b.id);
    assert.ok(headings.length);
    assert.equal(new Set(headings).size, headings.length);
    assert.ok(!headings.includes("programa-completo"));
  }
  assert.ok(!examples.has("desconocido"));
  assert.ok(!articles.has("desconocido"));
});

test("cada copia tiene identidad independiente, conserva el borrador exacto y se recupera al límite", () => {
  const original = revise(
    createDocument("mi-trabajo.etl", "// texto propio", []),
    { inspector: "ir", source: "// última revisión" },
  );
  let workspace = { version: 1, active: original, drafts: [] };
  for (const example of content.examples) {
    const copy = createDocument(example.name, example.code);
    workspace = replaceDocument(workspace, copy);
    assert.equal(copy.passes, null);
    assert.equal(copy.inspector, "check");
    assert.equal(copy.revision, 1);
  }
  assert.deepEqual(workspace.drafts.at(-1), original);
  workspace = replaceDocument(
    workspace,
    createDocument(content.examples[0].name, content.examples[0].code),
  );
  assert.notEqual(
    workspace.active.id,
    workspace.drafts.find((d) => d.name === workspace.active.name).id,
  );
  let stored;
  assert.ok(
    writeWorkspace({ setItem: (_, raw) => (stored = raw) }, workspace).saved,
  );
  workspace = replaceDocument(decode(stored), original);
  assert.deepEqual(workspace.active, original);
  assert.deepEqual(workspace.active.passes, []);
});

test("lector conserva código, tablas, listas continuadas y anclas con acentos o repetidas", () => {
  const blocks = markdown(
    "## Expresión\n\nUn `NULL`.\n\n## Expresión\n\n```text\n## código\n x == 2\n```\n\n| A | B |\n|---|---|\n| a | b |\n\n- primera\n  continuación\n- segunda",
  );
  assert.deepEqual(
    blocks.filter((b) => b.kind === "heading").map((b) => b.id),
    ["expresion", "expresion-2"],
  );
  assert.equal(
    blocks.find((b) => b.kind === "code").text,
    "## código\n x == 2",
  );
  assert.equal(blocks.find((b) => b.kind === "table").rows.length, 2);
  assert.deepEqual(blocks.find((b) => b.kind === "list").items, [
    "primera continuación",
    "segunda",
  ]);
});

test("tutorial publicado: bloques con lenguaje conocido, programa válido y enlaces internos", () => {
  const article = content.articles.find((a) => a.slug === "tutorial");
  assert.ok(article);
  const example = content.examples.find((e) => e.slug === article.program);
  assert.equal(example.source, "demo/tutorial.etl");
  assert.deepEqual(example.datasets, [
    { pipeline: "gasto_por_cliente", declaration: "pedidos", dataset: "join-orders", version: "1" },
  ]);
  const blocks = markdown(article.body);
  const languages = new Set(blocks.filter((b) => b.kind === "code").map((b) => b.language));
  assert.deepEqual([...languages].sort(), ["csv", "output", "sh", "text"]);
  for (const block of blocks.filter((b) => b.kind === "code" && b.language === "text"))
    assert.ok(example.code.includes(block.text) || block.text.includes("importes"));
  const links = [...article.body.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.includes("/studio?vista=ejecucion"));
  for (const link of links)
    assert.match(link, /^(\/docs\/|\/ejemplos\/|\/studio\?vista=[a-z]+$)/);
  const guide = content.articles.find((a) => a.slug === "primer-programa");
  assert.ok(guide.body.includes("(/docs/tutorial)"));
});
