import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { alignedDiff } from "../src/components/inspectors/diff.ts";
import {
  astTree,
  parseTree,
  treeNodes,
} from "../src/components/inspectors/tree.ts";
import {
  buildPipeline,
  initialBuilder,
  newBlock,
  OPERATIONS,
} from "../src/blocks/model.ts";

function analyze(sources) {
  const run = spawnSync(
    ".venv/bin/python",
    [
      "-c",
      `
import json, sys
from etl_dsl import analyze
print(json.dumps([analyze(source).to_dict() for source in json.load(sys.stdin)]))
`,
    ],
    {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      input: JSON.stringify(sources),
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("diff conserva contenido y números exactos al alinear inserciones, retiradas y reemplazos", () => {
  for (const [before, after] of [
    ["a\nb\nc", "a\nx\nc\nd"],
    ["", "a"],
    ["a", ""],
    ["x\nx\ny", "x\ny"],
    ["😀\né", "😀\nÉ"],
    ["a\n", "a"],
  ]) {
    const diff = alignedDiff(before, after);
    assert.equal(
      diff.rows
        .filter((r) => r.before)
        .map((r) => r.before.text)
        .join("\n"),
      before,
    );
    assert.equal(
      diff.rows
        .filter((r) => r.after)
        .map((r) => r.after.text)
        .join("\n"),
      after,
    );
    for (const side of ["before", "after"])
      assert.deepEqual(
        diff.rows.filter((r) => r[side]).map((r) => r[side].number),
        Array.from(
          { length: diff.rows.filter((r) => r[side]).length },
          (_, i) => i + 1,
        ),
      );
    for (const row of diff.rows)
      if (row.before?.change === "same")
        assert.equal(row.before.text, row.after.text);
  }
});

test("constructor genera siete operaciones aceptadas por el compilador real", () => {
  const base = initialBuilder();
  const sources = OPERATIONS.map(([op]) => {
    const block = newBlock(op, base.columns);
    if (op === "aggregate") {
      block.group = "cliente";
      block.column = "importe";
    }
    const result = buildPipeline({ ...base, blocks: [block] });
    assert.deepEqual(result.errors, [], `${op}: ${result.errors}`);
    return result.source;
  });
  const results = analyze(sources);
  results.forEach((result, i) =>
    assert.equal(
      result.ok,
      true,
      `${OPERATIONS[i][0]}: ${JSON.stringify(result.diagnostics)}`,
    ),
  );
});

test("bloques enlazados conservan columnas derivadas y resumen; una reordenación inválida no se aplica", () => {
  const base = initialBuilder();
  const derive = {
    ...newBlock("derive", base.columns),
    column: "importe",
    alias: "con_igv",
  };
  const aggregate = {
    ...newBlock("aggregate", base.columns),
    column: "con_igv",
    alias: "total",
    group: "cliente",
  };
  const sort = { ...newBlock("sort", base.columns), column: "total" };
  const result = buildPipeline({ ...base, blocks: [derive, aggregate, sort] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(
    result.stages.at(-1).map((c) => c.name),
    ["cliente", "total"],
  );
  assert.equal(analyze([result.source])[0].ok, true);
  assert.ok(
    buildPipeline({ ...base, blocks: [aggregate, derive, sort] }).errors.some(
      (e) => e.includes("con_igv"),
    ),
  );
});

test("nombres, duplicados, NULL, tipos y cadenas escapadas no crean código válido por accidente", () => {
  const base = initialBuilder();
  assert.ok(buildPipeline({ ...base, name: "PIPELINE" }).errors.length);
  assert.ok(
    buildPipeline({ ...base, columns: [base.columns[0], base.columns[0]] })
      .errors.length,
  );
  assert.ok(buildPipeline({ ...base, output: base.file }).errors.length);
  assert.ok(
    buildPipeline({ ...base, blocks: [{ ...base.blocks[0], value: "NULL" }] })
      .errors.length,
  );
  const stringColumn = { name: "texto", type: "STRING", nullable: true };
  const result = buildPipeline({
    ...base,
    columns: [stringColumn],
    file: 'a"\\b.csv',
    blocks: [{ ...newBlock("filter", [stringColumn]), value: 'a"; } 😀\n' }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(analyze([result.source])[0].ok, true);
  const nullResult = buildPipeline({
    ...base,
    columns: [stringColumn],
    blocks: [{ ...newBlock("filter", [stringColumn]), operator: "IS NULL" }],
  });
  assert.equal(analyze([nullResult.source])[0].ok, true);
});

test("árboles representan el AST y pretty() reales sin inventar posiciones para reglas", () => {
  const [compiled] = analyze([buildPipeline(initialBuilder()).source]);
  const ast = astTree(compiled.artifacts.ast.data);
  const nodes = treeNodes(ast.root);
  assert.ok(nodes.some((n) => n.kind === "Filter" && n.span));
  assert.ok(nodes.some((n) => n.kind === "Source" && n.name.includes("datos")));
  assert.equal(new Set(nodes.map((n) => n.id)).size, nodes.length);
  const pretty = compiled.artifacts.tree.data;
  const parsed = parseTree(pretty);
  assert.equal(parsed.root.name, "start");
  assert.ok(treeNodes(parsed.root).some((n) => n.name === "filter_op"));
  assert.ok(treeNodes(parsed.root).every((n) => !n.span));
  assert.equal(parseTree("\n"), null);
  assert.equal(astTree(compiled.artifacts.ast.data).limited, false);
});
