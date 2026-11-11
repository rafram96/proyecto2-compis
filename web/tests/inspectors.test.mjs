import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  available,
  clean,
  hasUnsafeInteger,
  numericText,
  compareIR,
  flowGraph,
  pipelines,
  spanOf,
  unavailable,
} from "../src/components/inspectors/model.ts";
import {
  createDocument,
  revise,
  sourceSelection,
  pythonDownload,
  PASSES,
} from "../src/workspace/model.ts";
import { decode } from "../src/workspace/persistence.ts";

// Artefactos del núcleo actual, nunca un AST ni pruebas de optimización escritos a mano.
const compile = spawnSync(
  ".venv/bin/python",
  [
    "-c",
    `
import json
from pathlib import Path
from etl_dsl import analyze
cases = {name: Path(path).read_text() for name, path in {
 'ventas':'web/scripts/programs/ventas.etl', 'risk':'input/credit_risk.etl',
 'ranges':'demo/rangos.etl', 'join':'demo/joins.etl', 'fusion':'demo/optimizaciones.etl',
 'structural':'web/scripts/programs/pendientes.etl'}.items()}
cases['multiUse'] = 'PIPELINE dual { INPUT a: TABLE[v: INT]; INPUT b: TABLE[v: INT]; OUTPUT oa: TABLE; OUTPUT ob: TABLE; FLOW { a -> oa; b -> ob; } } PIPELINE caller { INPUT x: TABLE[v: INT]; INPUT y: TABLE[v: INT]; USE dual AS d; OUTPUT ox: TABLE; OUTPUT oy: TABLE; FLOW { x -> d.a; y -> d.b; d.oa -> ox; d.ob -> oy; } }'
cases['cycle'] = 'PIPELINE p { STEP a = FILTER { WHERE TRUE; } STEP b = FILTER { WHERE TRUE; } OUTPUT o: TABLE; FLOW { a -> b -> a; b -> o; } }'
cases.update(syntax='PIPELINE p {', semantic='PIPELINE p { INPUT i: TABLE[x: INT]; STEP f = SELECT { COLUMNS ausente; } OUTPUT o: TABLE; FLOW { i -> f -> o; } }', branch='PIPELINE p { INPUT i: TABLE[x: INT]; STEP a = FILTER { WHERE x > 0; } STEP b = FILTER { WHERE x < 10; } OUTPUT oa: TABLE; OUTPUT ob: TABLE; FLOW { i -> a -> oa; i -> b -> ob; } }')
out = {key: analyze(value).to_dict() for key, value in cases.items()}
out['O0'] = analyze(cases['join'], passes=[]).to_dict()
out['custom'] = analyze(cases['ranges'], passes=['muertos','rangos','constantes']).to_dict()
out['astOnly'] = analyze(cases['ventas'], artifacts=['ast']).to_dict()
print(json.dumps(out))
`,
  ],
  {
    cwd: new URL("../..", import.meta.url),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  },
);
// cwd es raíz: ruta explícita para Python local.
if (compile.error || compile.status !== 0)
  throw new Error(compile.error?.message || compile.stderr);
const data = JSON.parse(compile.stdout);
const ast = (key) => available(data[key].artifacts.ast);
const mod = (key, side) => available(data[key].artifacts[side])?.module;
const rows = (key) =>
  mod(key, "ir_before").pipelines.flatMap((p) =>
    compareIR(
      p.nodes,
      mod(key, "ir_after").pipelines.find((a) => a.name === p.name).nodes,
    ),
  );

test("AST y FLOW reales: pipelines, USE, puertos JOIN, cadenas y ramificaciones deterministas", () => {
  assert.equal(pipelines(ast("risk")).length, 3);
  assert.equal(
    flowGraph(ast("risk"), "credit_risk").nodes.find(
      (n) => n.name === "cleaned",
    ).detail,
    "FILL_NULL",
  );
  const g = flowGraph(ast("risk"), "order_report");
  assert.deepEqual(g, flowGraph(ast("risk"), "order_report"));
  assert.ok(
    g.nodes.some(
      (n) =>
        n.kind === "USE" &&
        n.inputs.includes("orders") &&
        n.outputs.includes("cleaned"),
    ),
  );
  assert.ok(
    g.edges.some((e) => e.fromPort === "cleaned" && e.toPort === "left"),
  );
  assert.ok(g.edges.some((e) => e.toPort === "right"));
  assert.ok(g.edges.every((e) => spanOf(e.span)));
  assert.ok(g.nodes.every((n) => n.x >= 0 && n.y + n.height <= g.height));
  const branch = flowGraph(ast("branch"), "p");
  assert.equal(branch.edges.filter((e) => e.from === "i").length, 2);
  assert.equal(
    branch.nodes.find((n) => n.name === "a").y,
    branch.nodes.find((n) => n.name === "b").y,
  );
  assert.notEqual(
    branch.nodes.find((n) => n.name === "a").x,
    branch.nodes.find((n) => n.name === "b").x,
  );
  assert.equal(
    flowGraph(ast("join"), "join_verificado").nodes.find(
      (n) => n.name === "unidos",
    ).kind,
    "STEP",
  );
});

test("FLOW preserva múltiples puertos USE e informa ciclos sin reinterpretar el programa", () => {
  const graph = flowGraph(ast("multiUse"), "caller");
  assert.equal(data.multiUse.ok, true);
  assert.deepEqual(graph.nodes.find((n) => n.kind === "USE").inputs, [
    "a",
    "b",
  ]);
  assert.deepEqual(graph.nodes.find((n) => n.kind === "USE").outputs, [
    "oa",
    "ob",
  ]);
  assert.equal(graph.edges.length, 4);
  assert.equal(flowGraph(ast("cycle"), "p").unresolved, true);
  assert.equal(data.cycle.artifacts.ir_before.status, "blocked");
  const long = structuredClone(ast("multiUse"));
  long.pipelines[1].declarations[0].name = "nombre".repeat(30);
  const sized = flowGraph(long, "caller");
  assert.ok(sized.nodes[0].height > graph.nodes[0].height);
  assert.ok(sized.nodes.every((n) => n.y + n.height <= sized.height));
});

test("artefactos ausentes, bloqueados y parciales respetan fases reales", () => {
  assert.equal(available(data.syntax.artifacts.ast), undefined);
  assert.match(unavailable(data.syntax.artifacts.ast), /bloqueado/);
  assert.ok(ast("structural"));
  assert.equal(data.structural.artifacts.ir_before.status, "blocked");
  assert.ok(mod("semantic", "ir_before"));
  assert.equal(data.semantic.artifacts.ir_after.status, "blocked");
  assert.equal(data.semantic.artifacts.schemas.status, "blocked");
  assert.equal(data.astOnly.artifacts.ir_before.status, "not_requested");
  assert.match(unavailable(data.astOnly.artifacts.ir_before), /no se solicitó/);
  assert.equal(flowGraph(undefined, "p").nodes.length, 0);
});

test("comparación de una respuesta identifica conservación, cambios, eliminación y fusión por origin", () => {
  assert.ok(rows("ventas").some((r) => r.status === "cambiado"));
  assert.ok(
    rows("ranges").some(
      (r) => r.status === "eliminado" && r.before.name === "no_negativas",
    ),
  );
  assert.ok(
    rows("join").some(
      (r) => r.after?.kind === "CHECK_JOIN" && r.status === "cambiado",
    ),
  );
  assert.ok(rows("fusion").some((r) => r.after?.origin.length > 1));
  assert.ok(rows("O0").every((r) => r.status === "conservado"));
  const n = mod("ventas", "ir_before").pipelines[0].nodes[0];
  assert.equal(
    compareIR([{ ...n, origin: [] }], [{ ...n, origin: [] }])[0].status,
    "sin correspondencia",
  );
  assert.equal(
    compareIR([n], [{ ...n, origin: [] }])[0].status,
    "sin correspondencia",
  );
  assert.equal("span" in clean(n), false);
  const unsafe = { ...n, payload: { value: 9007199254740993 } };
  assert.equal(hasUnsafeInteger(unsafe), true);
  assert.match(numericText(unsafe.payload.value), /sin precisión segura/);
  assert.equal(compareIR([unsafe], [unsafe])[0].status, "sin correspondencia");
});

test("evidencia O1/O3 y esquemas conservan procedencia y etapas del núcleo", () => {
  const range = mod("ranges", "ir_after");
  assert.deepEqual(
    range.range_rewrites.map((r) => r.action),
    ["remove_filter", "simplify_predicate"],
  );
  assert.ok(
    range.range_rewrites.every((r) => r.proof[0].lower.evidence[0].span),
  );
  assert.ok(range.range_facts.some((f) => f.node === "validas"));
  const j = mod("join", "ir_after").join_rewrites[0];
  assert.ok(j.static_proof.includes("all_consumers_select_only_left_columns"));
  assert.ok(j.obligations.includes("unique_right_key"));
  assert.equal(j.eliminated, "clientes");
  assert.ok(
    mod("join", "ir_after").pipelines[0].nodes.some(
      (n) => n.name === j.eliminated,
    ),
  );
  assert.equal(mod("O0", "ir_after").join_rewrites.length, 0);
  assert.equal(
    data.O0.artifacts.python.data.includes("verify_many_to_one"),
    true,
  );
  const schemas = available(data.ventas.artifacts.schemas);
  assert.ok(
    Object.values(schemas.ventas).some((ports) => ports[""].complete === false),
  );
  assert.ok(
    Object.values(schemas.ventas).some((ports) =>
      ports[""].columns.some((c) => c.types === null),
    ),
  );
  assert.deepEqual(data.custom.applied_passes, [
    "muertos",
    "rangos",
    "constantes",
  ]);
});

test("v1 restaura null, O0 y orden explícito sin resultados; cambiar modo u orden crea revisión", () => {
  for (const passes of [
    null,
    [],
    [...PASSES],
    ["muertos", "rangos", "constantes"],
  ]) {
    const doc = revise(createDocument("p.etl", "", passes), {
      inspector: "flow",
    });
    const restored = decode(
      JSON.stringify({ version: 1, active: doc, drafts: [] }),
    );
    assert.deepEqual(restored.active, doc);
    assert.equal(revise(doc, { inspector: "schemas" }).revision, doc.revision);
  }
  const doc = createDocument("p.etl", "", ["rangos", "constantes"]);
  assert.equal(revise(doc, { passes: ["constantes", "rangos"] }).revision, 2);
  assert.equal(
    revise(createDocument("p.etl", ""), { passes: [...PASSES] }).revision,
    2,
  );
});

test("selección Unicode/multilínea/EOF se bloquea por documento, revisión y pases, como Python", () => {
  const doc = createDocument("p.etl", '"😀" x\n IS NULL');
  const result = {
    documentId: doc.id,
    revision: doc.revision,
    passes: null,
    result: data.ventas,
  };
  const span = {
    line: 1,
    column: 5,
    end_line: 2,
    end_column: 9,
    start: 4,
    end: 14,
  };
  const range = sourceSelection(doc, result, span);
  assert.equal(doc.source.slice(range.from, range.to), "x\n IS NULL");
  for (const changed of [
    revise(doc, { source: "nuevo" }),
    revise(doc, { passes: [] }),
    { ...doc, id: "otro" },
  ]) {
    assert.equal(sourceSelection(changed, result, span), null);
    assert.equal(pythonDownload(changed, result), null);
  }
  assert.deepEqual(
    sourceSelection(doc, result, {
      ...span,
      line: 2,
      column: 9,
      end_line: 2,
      end_column: 9,
    }),
    { from: doc.source.length, to: doc.source.length },
  );
});
