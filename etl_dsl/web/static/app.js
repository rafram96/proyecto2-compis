"use strict";

// Cliente del entorno: editor Monaco + paneles que muestran la respuesta de /api/compile y /api/run.

const MONACO = "https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min";
const PASSES = ["constantes", "filtros", "codigo_muerto"];
// Texto de cada pase en la interfaz; la API sigue usando el nombre interno.
const PASS_LABELS = { constantes: "Constantes", filtros: "Filtros", codigo_muerto: "Código muerto" };
const STAGES = {
  lexical: "léxico", syntax: "sintaxis", structure: "estructura",
  types: "tipos", codegen: "generación", runtime: "ejecución",
};
const STORAGE_KEY = "etl-dsl.source";
const COMPILE_DELAY_MS = 300;

const LANGUAGE = {
  keywords: ["PIPELINE", "FROM", "TO", "INPUT", "OUTPUT", "SOURCE", "SINK", "STEP", "USE", "AS", "FLOW", "TABLE",
    "FILTER", "SELECT", "DERIVE", "AGGREGATE", "JOIN", "SORT", "DISTINCT", "RENAME", "FILL_NULL",
    "DROP_NULLS", "WHERE", "COLUMNS", "GROUP_BY", "TYPE", "ON", "BY", "AND", "OR", "NOT", "IS"],
  types: ["INT", "DECIMAL", "STRING", "BOOL", "DATE", "DATETIME"],
  functions: ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "SAFE_DIVIDE", "LOWER", "UPPER", "TRIM"],
  constants: ["NULL", "TRUE", "FALSE", "INNER", "LEFT", "RIGHT", "FULL", "ASC", "DESC"],
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, "string", "@string"],
      [/\d+(\.\d+)?([eE][+-]?\d+)?/, "number"],
      [/[A-Za-z_]\w*/, {
        cases: {
          "@keywords": "keyword", "@types": "type", "@functions": "function",
          "@constants": "constant", "@default": "identifier",
        },
      }],
      [/->|==|!=|<=|>=|[<>+\-*\/=?]/, "operator"],
      [/[{}()[\]]/, "@brackets"],
      [/[;,.:]/, "delimiter"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],
  },
};

const THEMES = {
  "etl-light": {
    base: "vs", inherit: true, colors: {},
    rules: [
      { token: "keyword", foreground: "2f6fb0", fontStyle: "bold" },
      { token: "type", foreground: "1f6b3f" },
      { token: "function", foreground: "7b4bb3" },
      { token: "constant", foreground: "b3611e" },
      { token: "string", foreground: "8a4b12" },
      { token: "comment", foreground: "7d8b97", fontStyle: "italic" },
    ],
  },
  "etl-dark": {
    base: "vs-dark", inherit: true, colors: { "editor.background": "#101820" },
    rules: [
      { token: "keyword", foreground: "6ea8e0", fontStyle: "bold" },
      { token: "type", foreground: "8fd1a8" },
      { token: "function", foreground: "c3a3ea" },
      { token: "constant", foreground: "f0a35a" },
      { token: "string", foreground: "e3b98a" },
      { token: "comment", foreground: "7d8b97", fontStyle: "italic" },
    ],
  },
};

const state = { result: null, version: "after", sequence: 0, controller: null, timer: null };
let monacoApi, editor, codeViewer;

const $ = (selector) => document.querySelector(selector);

function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

// localStorage puede no estar disponible (modo privado, políticas del navegador).
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, value); } catch { /* sin persistencia */ }
}

async function request(url, body, signal) {
  const response = await fetch(url, body === undefined ? { signal } : {
    method: "POST", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(typeof detail.detail === "string" ? detail.detail : `HTTP ${response.status}`);
  }
  return response.json();
}

// Editor

function setupMonaco(monaco) {
  monacoApi = monaco;
  monaco.languages.register({ id: "etl" });
  monaco.languages.setMonarchTokensProvider("etl", LANGUAGE);
  monaco.languages.setLanguageConfiguration("etl", {
    comments: { lineComment: "//" },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" },
      { open: "\"", close: "\"", notIn: ["string"] }],
  });
  const words = [
    ...LANGUAGE.keywords.map((w) => [w, monaco.languages.CompletionItemKind.Keyword]),
    ...LANGUAGE.types.map((w) => [w, monaco.languages.CompletionItemKind.TypeParameter]),
    ...LANGUAGE.functions.map((w) => [w, monaco.languages.CompletionItemKind.Function]),
    ...LANGUAGE.constants.map((w) => [w, monaco.languages.CompletionItemKind.Constant]),
  ];
  monaco.languages.registerCompletionItemProvider("etl", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      return { suggestions: words.map(([label, kind]) => ({ label, kind, insertText: label, range })) };
    },
  });
  for (const [name, theme] of Object.entries(THEMES)) monaco.editor.defineTheme(name, theme);

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const theme = () => (dark.matches ? "etl-dark" : "etl-light");
  dark.addEventListener("change", () => monaco.editor.setTheme(theme()));

  const common = {
    theme: theme(), automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
    fontFamily: "JetBrains Mono, Courier New, monospace", fontSize: 13.5, tabSize: 4,
  };
  editor = monaco.editor.create($("#editor"), { ...common, language: "etl", value: "" });
  codeViewer = monaco.editor.create($("#code"), { ...common, language: "python", readOnly: true, value: "" });

  editor.onDidChangeModelContent(() => {
    save(STORAGE_KEY, editor.getValue());
    scheduleCompile();
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run);
}

function selectSpan(span) {
  if (!span || !span.start) return;
  const range = new monacoApi.Range(span.start.line, span.start.column, span.end.line, span.end.column);
  editor.setSelection(range);
  editor.revealRangeInCenter(range);
  editor.focus();
}

function markerRange(d) {
  // Monaco no muestra marcadores de ancho cero.
  const sameLine = d.end.line === d.start.line;
  const endColumn = sameLine ? Math.max(d.end.column, d.start.column + 1) : d.end.column;
  return {
    startLineNumber: d.start.line, startColumn: d.start.column,
    endLineNumber: d.end.line, endColumn,
  };
}

// Compilación

function selectedPasses() {
  return PASSES.filter((name) => $(`#pass-${name}`).checked);
}

function scheduleCompile() {
  clearTimeout(state.timer);
  state.timer = setTimeout(compile, COMPILE_DELAY_MS);
}

async function send(url) {
  // Solo cuenta la respuesta de la última petición: las anteriores se cancelan.
  state.controller?.abort();
  state.controller = new AbortController();
  const sequence = ++state.sequence;
  const result = await request(url, { source: editor.getValue(), passes: selectedPasses() },
    state.controller.signal);
  return sequence === state.sequence ? result : null;
}

async function compile() {
  setStatus("Compilando…");
  try {
    const result = await send("/api/compile");
    if (result) show(result);
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`Error del servidor: ${error.message}`, "error");
  }
}

async function run() {
  clearTimeout(state.timer);
  const button = $("#run");
  button.disabled = true;
  setStatus("Ejecutando…");
  try {
    const result = await send("/api/run");
    if (!result) return;
    show(result);
    renderResults(result.results);
    if (result.ok) selectTab("results");
  } catch (error) {
    if (error.name !== "AbortError") setStatus(`Error del servidor: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

function setStatus(text, kind = "") {
  const status = $("#status");
  status.textContent = text;
  status.className = `status ${kind}`;
}

function show(result) {
  state.result = result;
  const diagnostics = result.diagnostics;
  monacoApi.editor.setModelMarkers(editor.getModel(), "etl", diagnostics.map((d) => ({
    ...markerRange(d), severity: monacoApi.MarkerSeverity.Error, message: `${d.code}: ${d.message}`,
  })));
  if (diagnostics.length) {
    const stage = STAGES[diagnostics[0].stage] ?? diagnostics[0].stage;
    setStatus(`${diagnostics.length} error${diagnostics.length > 1 ? "es" : ""} de ${stage}`, "error");
  } else {
    setStatus("Sin errores", "ok");
  }
  renderProblems(diagnostics);
  renderGraph();
  renderAst(result.ast);
  $("#ir-before").textContent = result.ir.before?.text ?? "La IR se genera cuando sintaxis y estructura son válidas.";
  $("#ir-after").textContent = result.ir.after?.text ?? "La IR optimizada se genera cuando no hay errores de tipos.";
  codeViewer.setValue(result.code ?? "# El código se genera cuando el programa no tiene errores.");
}

function renderProblems(diagnostics) {
  const list = $("#problems");
  list.replaceChildren();
  if (!diagnostics.length) {
    list.append(element("li", { class: "none" }, "No hay problemas."));
    return;
  }
  for (const d of diagnostics) {
    const button = element("button", { type: "button" });
    button.append(element("span", { class: "pos" }, `${d.start.line}:${d.start.column}`),
      element("span", { class: "code" }, d.code),
      element("span", { class: "msg" }, d.message));
    button.addEventListener("click", () => selectSpan(d));
    const item = element("li");
    item.append(button);
    list.append(item);
  }
}

// Grafo de la IR

const NODE = { width: 196, height: 60, pad: 12 };
// Separación entre capas y entre nodos de una misma capa, según la orientación.
const GAPS = { horizontal: { layer: 56, row: 22 }, vertical: { layer: 40, row: 24 } };
const CHAR_WIDTH = { name: 8, kind: 7 };  // px aproximados por carácter en las fuentes del grafo
const CATEGORY = { SOURCE: "source", INPUT: "source", SINK: "sink", OUTPUT: "sink", JOIN: "join", USE: "use" };

function layout(pipeline, vertical) {
  // Capa = camino más largo desde una fuente; dentro de la capa, orden por baricentro de los predecesores.
  const predecessors = new Map(pipeline.nodes.map((n) => [n.id, []]));
  for (const edge of pipeline.edges) predecessors.get(edge.to).push(edge.from);
  const layer = new Map();
  for (const node of pipeline.nodes) {  // los nodos llegan en orden topológico
    layer.set(node.id, Math.max(-1, ...predecessors.get(node.id).map((id) => layer.get(id))) + 1);
  }
  const layers = [];
  for (const node of pipeline.nodes) (layers[layer.get(node.id)] ??= []).push(node);
  const row = new Map();
  for (const nodes of layers) {
    const center = (node) => {
      const rows = predecessors.get(node.id).map((id) => row.get(id));
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity;
    };
    nodes.map((node, index) => ({ node, index, key: center(node) }))
      .sort((a, b) => (a.key - b.key) || (a.index - b.index))
      .forEach(({ node }, index) => row.set(node.id, index));
  }
  // Horizontal: las capas avanzan hacia la derecha. Vertical: hacia abajo.
  const gap = vertical ? GAPS.vertical : GAPS.horizontal;
  const along = vertical ? NODE.height : NODE.width;   // tamaño en la dirección del flujo
  const across = vertical ? NODE.width : NODE.height;  // tamaño dentro de una capa
  const position = new Map(pipeline.nodes.map((node) => {
    const a = NODE.pad + layer.get(node.id) * (along + gap.layer);
    const b = NODE.pad + row.get(node.id) * (across + gap.row);
    return [node.id, vertical ? { x: b, y: a } : { x: a, y: b }];
  }));
  const rows = Math.max(...layers.map((nodes) => nodes.length));
  const length = NODE.pad * 2 + layers.length * along + (layers.length - 1) * gap.layer;
  const breadth = NODE.pad * 2 + rows * across + (rows - 1) * gap.row;
  return { position, width: vertical ? breadth : length, height: vertical ? length : breadth };
}

function edgePath(from, to, vertical) {
  if (vertical) {
    const x1 = from.x + NODE.width / 2, y1 = from.y + NODE.height;
    const x2 = to.x + NODE.width / 2, y2 = to.y;
    const bend = (y2 - y1) / 2;
    return { d: `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`, start: [x1, y1], end: [x2, y2] };
  }
  const x1 = from.x + NODE.width, y1 = from.y + NODE.height / 2;
  const x2 = to.x, y2 = to.y + NODE.height / 2;
  const bend = (x2 - x1) / 2;
  return { d: `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`, start: [x1, y1], end: [x2, y2] };
}

function truncate(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function renderGraph() {
  const container = $("#graph");
  container.replaceChildren();
  $("#node-detail").hidden = true;
  const ir = state.result?.ir;
  const version = state.version === "after" && ir?.after ? ir.after : ir?.before;
  if (!version) {
    container.append(element("p", { class: "empty" }, "El grafo aparece cuando sintaxis y estructura son válidas."));
    return;
  }
  if (!container.clientWidth) return;  // pestaña oculta: se dibuja al mostrarla
  const available = container.clientWidth - 2 * NODE.pad;
  for (const pipeline of version.pipelines) {
    const title = element("h3", {}, pipeline.name);
    if (pipeline.root) title.append(" ", element("small", {}, "· raíz"));
    // De arriba hacia abajo solo si el grafo horizontal no cabe en el panel.
    const vertical = layout(pipeline, false).width > available;
    container.append(title, drawPipeline(pipeline, vertical));
  }
}

function drawPipeline(pipeline, vertical) {
  const { position, width, height } = layout(pipeline, vertical);
  const root = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img",
    "aria-label": `Grafo del pipeline ${pipeline.name}` });
  const defs = svg("defs");
  const marker = svg("marker", { id: `arrow-${pipeline.name}`, viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "7", markerHeight: "7", orient: "auto" });
  marker.append(svg("path", { d: "M0,0 L10,5 L0,10 z", class: "arrow" }));
  defs.append(marker);
  root.append(defs);

  for (const edge of pipeline.edges) {
    const path = edgePath(position.get(edge.from), position.get(edge.to), vertical);
    root.append(svg("path", { class: "edge", d: path.d, "marker-end": `url(#arrow-${pipeline.name})` }));
    const [x1, y1] = path.start;
    const [x2, y2] = path.end;
    if (edge.from_port) {
      root.append(svg("text", { class: "port", x: x1 + 4, y: vertical ? y1 + 12 : y1 - 5 }, edge.from_port));
    }
    if (edge.to_port) {
      root.append(svg("text", vertical ? { class: "port", x: x2 + 4, y: y2 - 5 }
        : { class: "port", x: x2 - 4, y: y2 - 5, "text-anchor": "end" }, edge.to_port));
    }
  }

  for (const node of pipeline.nodes) {
    const { x, y } = position.get(node.id);
    const category = CATEGORY[node.kind] ?? "step";
    const group = svg("g", { class: "node", transform: `translate(${x},${y})`, tabindex: "0", role: "button",
      "aria-label": `${node.kind} ${node.id}` });
    const details = [node.label, node.schema].filter(Boolean).join("\n");
    // El nombre usa el ancho que deja la etiqueta del tipo de nodo.
    const nameChars = Math.floor((NODE.width - 34 - node.kind.length * CHAR_WIDTH.kind) / CHAR_WIDTH.name);
    group.append(svg("title", {}, `${node.origin.join(" + ")}\n${details}`),
      svg("rect", { class: "box", width: NODE.width, height: NODE.height, rx: 8 }),
      svg("rect", { class: `stripe k-${category}`, width: 5, height: NODE.height - 2, x: 1, y: 1, rx: 2 }),
      svg("text", { class: "name", x: 14, y: 20 }, truncate(node.origin.join(" + "), nameChars)),
      svg("text", { class: `kind k-${category}`, x: NODE.width - 10, y: 20, "text-anchor": "end" }, node.kind),
      svg("text", { class: "label", x: 14, y: 42 }, truncate(node.label || " ", 27)));
    const select = () => selectNode(group, node);
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); }
    });
    root.append(group);
  }
  return root;
}

function selectNode(group, node) {
  document.querySelectorAll(".graph .node.selected").forEach((g) => g.classList.remove("selected"));
  group.classList.add("selected");
  const detail = $("#node-detail");
  detail.replaceChildren(element("h4", {}, `%${node.id} · ${node.kind}`));
  if (node.origin.length > 1) detail.append(element("p", {}, `Fusiona: ${node.origin.join(" + ")}`));
  if (node.label) {
    const p = element("p");
    p.append(element("code", {}, node.label));
    detail.append(p);
  }
  if (node.schema) {
    const p = element("p", {}, "Esquema: ");
    p.append(element("code", {}, node.schema));
    detail.append(p);
  }
  detail.hidden = false;
  selectSpan(node);
}

// AST

function scalar(value) {
  return value === null || typeof value !== "object";
}

function astNode(value, label, depth) {
  if (scalar(value)) return element("div", { class: "leaf" }, `${label}: ${JSON.stringify(value)}`);
  if (Array.isArray(value)) {
    const details = element("details");
    details.open = depth < 3;
    details.append(element("summary", { class: "attr" }, `${label} [${value.length}]`));
    value.forEach((item, index) => details.append(astNode(item, String(index), depth + 1)));
    return details;
  }
  const details = element("details");
  details.open = depth < 3;
  const summary = element("summary");
  if (label) summary.append(element("span", { class: "attr" }, `${label}: `));
  summary.append(element("span", { class: "node-name" }, value.node ?? "objeto"));
  const attributes = Object.entries(value).filter(([key, v]) => key !== "node" && key !== "span" && scalar(v));
  if (attributes.length) {
    summary.append(" ", element("span", { class: "attr" },
      attributes.map(([key, v]) => `${key}=${JSON.stringify(v)}`).join(" ")));
  }
  if (value.span) {
    summary.addEventListener("click", () => selectSpan({
      start: { line: value.span.line, column: value.span.column },
      end: { line: value.span.end_line, column: value.span.end_column },
    }));
  }
  details.append(summary);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "node" && key !== "span" && !scalar(child)) details.append(astNode(child, key, depth + 1));
  }
  return details;
}

function renderAst(ast) {
  const container = $("#ast");
  container.replaceChildren(ast ? astNode(ast, "", 0)
    : element("p", { class: "empty" }, "El AST aparece cuando la sintaxis es válida."));
}

// Resultados

function renderResults(results) {
  const container = $("#results");
  container.replaceChildren();
  if (!results) {
    container.append(element("p", { class: "empty" }, "La ejecución no terminó: revisa los problemas."));
    return;
  }
  for (const [pipeline, tables] of Object.entries(results)) {
    for (const [name, table] of Object.entries(tables)) {
      const title = element("h3", {}, `${pipeline} · ${name} `);
      const shown = table.rows.length;
      title.append(element("small", {}, shown < table.total_rows
        ? `${shown} de ${table.total_rows} filas` : `${table.total_rows} fila${table.total_rows === 1 ? "" : "s"}`));
      const wrap = element("div", { class: "table-wrap" });
      const grid = element("table");
      const head = element("tr");
      for (const column of table.columns) {
        const th = element("th", {}, column.name);
        th.append(element("small", {}, column.type));
        head.append(th);
      }
      const thead = element("thead");
      thead.append(head);
      const tbody = element("tbody");
      for (const row of table.rows) {
        const tr = element("tr");
        for (const value of row) {
          const cell = value === null ? element("td", { class: "null" }, "NULL")
            : element("td", { class: typeof value === "number" ? "num" : "" }, String(value));
          tr.append(cell);
        }
        tbody.append(tr);
      }
      grid.append(thead, tbody);
      wrap.append(grid);
      container.append(title, wrap);
    }
  }
}

// Interfaz

function selectTab(name) {
  document.querySelectorAll(".tabs [role=tab]").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.tab === name));
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
  if (name === "graph") renderGraph();
}

function setupControls() {
  const fieldset = $("#passes");
  for (const name of PASSES) {
    const label = element("label");
    const input = element("input", { type: "checkbox", id: `pass-${name}` });
    input.checked = true;
    input.addEventListener("change", compile);
    label.append(input, PASS_LABELS[name]);
    fieldset.append(label);
  }
  document.querySelectorAll(".tabs [role=tab]").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab));
  });
  document.querySelectorAll("[data-version]").forEach((button) => {
    button.addEventListener("click", () => {
      state.version = button.dataset.version;
      document.querySelectorAll("[data-version]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b === button));
      });
      renderGraph();
    });
  });
  $("#run").addEventListener("click", run);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderGraph, 150);
  });
  setupSplitter();
}

function setupSplitter() {
  // Arrastrar el borde entre el editor y los paneles cambia el ancho del editor (20 % a 80 %).
  const handle = $("#splitter");
  const main = handle.parentElement;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
    const rect = main.getBoundingClientRect();
    const move = (e) => {
      const percent = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100));
      main.style.setProperty("--editor-width", `${percent}%`);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      document.body.classList.remove("resizing");
      renderGraph();  // el grafo elige su orientación según el nuevo ancho
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  });
}

async function setupExamples() {
  const select = $("#examples");
  const names = await request("/api/examples");
  select.append(element("option", { value: "" }, "— elegir —"));
  for (const name of names) select.append(element("option", { value: name }, name));
  select.addEventListener("change", async () => {
    if (!select.value) return;
    const example = await request(`/api/examples/${select.value}`);
    editor.setValue(example.source);
  });
  return names;
}

window.MonacoEnvironment = {
  // Los workers de Monaco no pueden cargarse entre orígenes: se arrancan desde un data URL.
  getWorkerUrl() {
    const code = `self.MonacoEnvironment = { baseUrl: "${MONACO}/" };
      importScripts("${MONACO}/vs/base/worker/workerMain.js");`;
    return `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
  },
};

require.config({ paths: { vs: `${MONACO}/vs` } });
require(["vs/editor/editor.main"], async (monaco) => {
  setupMonaco(monaco);
  setupControls();
  const names = await setupExamples().catch(() => []);
  // ?ejemplo=demo/tipos.etl abre ese ejemplo; si no, el último programa editado o el primer ejemplo.
  const requested = new URLSearchParams(window.location.search).get("ejemplo");
  const stored = load(STORAGE_KEY);
  const example = names.includes(requested) ? requested
    : stored ? null : names.includes("input/duckdb.etl") ? "input/duckdb.etl" : names[0];
  if (example) {
    $("#examples").value = example;
    editor.setValue((await request(`/api/examples/${example}`)).source);
  } else if (stored) {
    editor.setValue(stored);
  }
  compile();
});
