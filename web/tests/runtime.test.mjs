import assert from "node:assert/strict";
import test from "node:test";
import { CompilerRuntime, SupersededError } from "../src/compiler/runtime.ts";
const req = (source) => ({
  source,
  name: "test.etl",
  fmt: "check",
  passes: null,
});
function result() {
  return {
    ok: true,
    out: "OK",
    err: "",
    analysis: {
      contract_version: "4",
      offset_encoding: "unicode-codepoints",
      source_hash: "test-hash",
      diagnostics: [],
      artifacts: Object.fromEntries(
        [
          "tokens",
          "tree",
          "ast",
          "ir_before",
          "ir_after",
          "python",
          "schemas",
        ].map((key) => [key, { status: "not_requested", data: null }]),
      ),
    },
  };
}
class Channel {
  sent = [];
  terminated = false;
  postMessage(message) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  message(data) {
    this.onmessage({ data });
  }
  ready() {
    this.message({ type: "status", status: "ready", detail: "Python listo" });
  }
  finish(index = 0) {
    this.message({ type: "result", id: this.sent[index].id, result: result() });
  }
}
const setup = () => {
  const channels = [];
  const runtime = new CompilerRuntime(
    () => {
      const w = new Channel();
      channels.push(w);
      return w;
    },
    { load: 100, compile: 20 },
  );
  return { runtime, channels };
};

test("agrupa ediciones: una solicitud en curso y solo la pendiente más reciente", async () => {
  const { runtime, channels } = setup();
  const first = runtime.compile(req("primero"));
  const skipped = runtime.compile(req("intermedio"));
  const rejected = assert.rejects(skipped, SupersededError);
  const last = runtime.compile(req("último"));
  await rejected;
  assert.equal(channels[0].sent.length, 1);
  channels[0].ready();
  channels[0].finish();
  await first;
  assert.equal(channels[0].sent.length, 2);
  assert.equal(channels[0].sent[1].source, "último");
  // No resuelve el trabajo actual con una respuesta duplicada antigua.
  channels[0].finish();
  channels[0].finish(1);
  await last;
  runtime.restart();
});

for (const kind of [
  "onerror",
  "onmessageerror",
  "failure",
  "invalid",
  "bad-result",
  "incompatible",
]) {
  test(`fallo ${kind} termina todas las promesas y permite recuperar`, async () => {
    const { runtime, channels } = setup();
    const active = runtime.compile(req("a"));
    const queued = runtime.compile(req("b"));
    const checks = [assert.rejects(active), assert.rejects(queued)];
    const channel = channels[0];
    if (kind === "onerror") channel.onerror({ preventDefault() {} });
    else if (kind === "onmessageerror") channel.onmessageerror();
    else if (kind === "failure")
      channel.message({
        type: "failure",
        id: channel.sent[0].id,
        message: "Falló Pyodide",
      });
    else if (kind === "bad-result")
      channel.message({
        type: "result",
        id: channel.sent[0].id,
        result: { ok: true },
      });
    else if (kind === "incompatible") {
      const value = result();
      value.analysis.contract_version = "3";
      channel.message({
        type: "result",
        id: channel.sent[0].id,
        result: value,
      });
    } else channel.message(null);
    await Promise.all(checks);
    assert.equal(runtime.state.status, "error");
    assert.equal(channel.terminated, true);
    const recovery = runtime.compile(req("recuperación"));
    channel.ready();
    channel.finish();
    channel.onerror({ preventDefault() {} });
    assert.equal(
      runtime.state.status,
      "loading",
      "ignora mensajes y errores del worker reemplazado",
    );
    channels[1].ready();
    channels[1].finish();
    await recovery;
    assert.equal(runtime.state.status, "ready");
    runtime.restart();
  });
}

test("fallo al construir o enviar el worker rechaza la promesa", async () => {
  for (const factory of [
    () => {
      throw new Error("sin worker");
    },
    () => ({
      postMessage() {
        throw new Error("canal cerrado");
      },
      terminate() {},
    }),
  ]) {
    const runtime = new CompilerRuntime(factory);
    await assert.rejects(runtime.compile(req("a")));
    assert.equal(runtime.state.status, "error");
  }
});

test("reinicio rechaza solicitudes activas y pendientes; no acepta resultados anteriores", async () => {
  const { runtime, channels } = setup();
  const a = runtime.compile(req("a")),
    b = runtime.compile(req("b"));
  const rejected = [
    assert.rejects(a, /reiniciado/),
    assert.rejects(b, /reiniciado/),
  ];
  runtime.restart();
  await Promise.all(rejected);
  assert.equal(runtime.state.status, "idle");
  const c = runtime.compile(req("c"));
  channels[0].ready();
  channels[0].finish();
  assert.equal(runtime.state.status, "loading");
  channels[1].ready();
  channels[1].finish();
  await c;
  runtime.restart();
});

test("timeout de carga no se prolonga con progreso; el de compilación empieza al estar listo", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { runtime, channels } = setup();
  let pending = runtime.compile(req("a"));
  let rejected = assert.rejects(pending, /carga/);
  t.mock.timers.tick(99);
  channels[0].message({
    type: "status",
    status: "loading",
    detail: "Instalando…",
  });
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(runtime.state.status, "error");
  pending = runtime.compile(req("b"));
  rejected = assert.rejects(pending, /compilación/);
  t.mock.timers.tick(90);
  channels[1].ready();
  t.mock.timers.tick(19);
  assert.equal(runtime.state.status, "ready");
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(runtime.state.status, "error");
  runtime.restart();
});
