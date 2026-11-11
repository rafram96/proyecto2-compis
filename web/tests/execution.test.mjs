import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createDocument, revise } from '../src/workspace/model.ts';
import { activeRun, bindingFields, cellText, requestKey, runRequest, sameRun, matchesRequest } from '../src/execution/model.ts';
import { decodeCapabilities, decodeRun } from '../src/execution/client.ts';

const binding = { pipeline: 'p', declaration: 'i', dataset_id: 'orders', version: '1' };
test('cada ejecución conserva fuente, revisión, pases, pipeline, bindings y versiones exactos', () => {
  const doc = createDocument('prueba.etl', '// 😀', ['muertos', 'joins']);
  const request = runRequest(doc, 'p', [binding]);
  assert.equal(request.source, doc.source);
  assert.deepEqual(request.passes, ['muertos', 'joins']);
  for (const candidate of [
    runRequest(revise(doc, { source: '// cambio' }), 'p', [binding]),
    runRequest(revise(doc, { passes: null }), 'p', [binding]),
    runRequest(revise(doc, { passes: [] }), 'p', [binding]),
    runRequest(doc, 'otro', [binding]),
    runRequest(doc, 'p', [{ ...binding, version: '2' }]),
    runRequest(doc, 'p', [{ ...binding, dataset_id: 'otro' }]),
    runRequest(createDocument('otro.etl', doc.source, doc.passes), 'p', [binding]),
  ]) assert.notEqual(requestKey(candidate), requestKey(request));
  assert.equal(requestKey(runRequest(revise(doc, { inspector: 'ast' }), 'p', [binding])), requestKey(request));
});

test('recorrido estructural incluye SOURCE de USE y solo INPUT raíz, sin implementar contratos', () => {
  const source = `PIPELINE p { INPUT i: TABLE[id: INT]; USE inner AS u; OUTPUT o: TABLE; FLOW { i -> u.i; u.o -> o; } }
  PIPELINE inner { INPUT i: TABLE[id: INT]; SOURCE side = CSV(file: "side.csv"); OUTPUT o: TABLE; OUTPUT extra: TABLE; FLOW { i -> o; side -> extra; } }`;
  const analysis = JSON.parse(execFileSync('../.venv/bin/python', ['-c', `import json,sys;sys.path.insert(0,'..');from etl_dsl import analyze;print(json.dumps(analyze(sys.stdin.read(),artifacts=('ast',)).to_dict()))`], { input: source, encoding: 'utf8' }));
  assert.equal(analysis.ok, true);
  assert.deepEqual(bindingFields(analysis.artifacts.ast.data, 'p').map((b) => `${b.pipeline}.${b.declaration}`), ['p.i', 'inner.side']);
  assert.deepEqual(bindingFields(analysis.artifacts.ast.data, 'inner').map((b) => `${b.pipeline}.${b.declaration}`), ['inner.i', 'inner.side']);
});

test('respuestas tardías solo pueden actualizar el mismo trabajo y documento', () => {
  const run = { id: 'a'.repeat(32), document_id: '1', revision: 3, source_hash: 'hash', state: 'running' };
  assert.equal(activeRun(run), true);
  assert.equal(activeRun({ ...run, state: 'succeeded' }), false);
  assert.equal(sameRun(run, { ...run, state: 'succeeded' }), true);
  assert.equal(sameRun({ ...run, state: 'cancelled' }, run), false);
  assert.equal(sameRun({ ...run, state: 'running' }, { ...run, state: 'queued' }), false);
  assert.equal(sameRun(run, { ...run, pipeline: 'otro' }), false);
  assert.equal(sameRun(run, { ...run, bindings: [binding] }), false);
  assert.equal(sameRun({ ...run, state: 'succeeded', expired: true }, { ...run, state: 'succeeded', expired: false }), false);
  for (const change of [{ id: 'b' }, { document_id: '2' }, { revision: 4 }, { source_hash: 'different' }]) assert.equal(sameRun(run, { ...run, ...change }), false);
});

test('contratos incompatibles se rechazan sin afectar compilación local', () => {
  const caps = { contract_version: '1', analysis_version: '4', compiler_version: '0.1.0', datasets: [], limits: { timeout_seconds: 30, memory_bytes: 512, ttl_seconds: 3600 }, default_passes: [] };
  assert.equal(decodeCapabilities(caps), caps);
  for (const change of [{ contract_version: '4' }, { analysis_version: '3' }, { datasets: null }, { datasets: [null] }, { limits: {} }, { compiler_version: 'future' }]) assert.throws(() => decodeCapabilities({ ...caps, ...change }), /incompatible/);
  assert.throws(() => decodeRun({ state: 'running' }), /incompatible/);
});

test('tabla muestra NULL, decimal, entero exacto y no finitos sin coerción numérica', () => {
  assert.equal(cellText(null), 'NULL');
  assert.equal(cellText('0.3000'), '0.3000');
  assert.equal(cellText('9007199254740993'), '9007199254740993');
  assert.equal(cellText({ kind: 'non_finite', value: 'NaN' }), 'NaN (non_finite)');
  assert.equal(cellText(false), 'false');
});

test('OpenAPI y tipos TypeScript corresponden al contrato real del servicio', () => {
  execFileSync('.venv/bin/python', ['web/scripts/gen_http.py', '--check'], { cwd: '..' });
});

test('la aceptación HTTP debe coincidir con fuente y opciones, incluso antes del primer sondeo', () => {
  const req = runRequest(createDocument('p.etl', '// original', []), 'p', [binding]);
  const run = { ...req, source_hash: 'sha', passes: [] };
  assert.equal(matchesRequest(req, run, 'sha'), true);
  for (const change of [{ source_hash: 'otro' }, { filename: 'otro.etl' }, { pipeline: 'otro' }, { passes: null }, { bindings: [] }]) assert.equal(matchesRequest(req, { ...run, ...change }, 'sha'), false);
});
