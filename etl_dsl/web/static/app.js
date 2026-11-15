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
const MAX_SOURCE = 200_000;  // el mismo límite que acepta el servidor
const TOKEN_ROWS = 1500;     // filas máximas de la tabla de tokens

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

// lastValid: último resultado con IR (esquemas). Alimenta la ayuda del editor
// mientras el texto tiene errores; puede corresponder a una versión anterior del programa.
const state = {
  result: null, lastValid: null, version: "after", sequence: 0, controller: null, timer: null,
  fileName: "programa.etl",
};
let monacoApi, editor, codeViewer;
// Pestañas Árbol y AST (arboles.js); se crean al arrancar.
const views = {};

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
  monaco.languages.registerHoverProvider("etl", { provideHover: hover });
  monaco.languages.registerCodeActionProvider("etl", { provideCodeActions: codeActions },
    { providedCodeActionKinds: ["quickfix"] });
  for (const [name, theme] of Object.entries(THEMES)) monaco.editor.defineTheme(name, theme);

  const theme = () => (window.etlTheme?.current() === "dark" ? "etl-dark" : "etl-light");
  window.addEventListener("etl-themechange", () => monaco.editor.setTheme(theme()));

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

// Ayuda del editor: información al pasar el mouse y correcciones rápidas.
// Las columnas y los nombres salen del último análisis con IR (state.lastValid), no se infieren aquí.

function typeText(column) {
  return `${column.type ?? "ANY"}${column.nullable ? " · admite NULL" : ""}`;
}

function insideStringOrComment(model, position) {
  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  let quoted = false;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === "\\" && quoted) i++;
    else if (before[i] === "\"") quoted = !quoted;
    else if (!quoted && before.startsWith("//", i)) return true;
  }
  return quoted;
}

function pipelineAt(result, line) {
  const pipelines = result.ast?.pipelines ?? [];
  const ast = pipelines.find((p) => p.span && p.span.line <= line && line <= p.span.end_line);
  const graph = result.ir.before?.pipelines.find((p) => p.name === ast?.name);
  return graph ? { ast, graph } : null;
}

// Columnas visibles en una línea: la entrada del paso que la contiene; en la forma lineal, entre pasos,
// la salida del paso anterior (la recibe el siguiente); si no, todas las columnas conocidas del pipeline.
function columnsAt(line) {
  const result = state.lastValid;
  const found = result && pipelineAt(result, line);
  if (!found) return null;
  const { ast, graph } = found;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = graph.nodes.filter((n) => n.start.line <= line && line <= n.end.line).at(-1);
  const columns = [];
  const add = (list, prefix = "") => {
    for (const column of list ?? []) {
      if (!columns.some((c) => c.name === prefix + column.name)) columns.push({ ...column, name: prefix + column.name });
    }
  };
  if (node && !["SOURCE", "INPUT"].includes(node.kind)) {
    for (const edge of graph.edges.filter((e) => e.to === node.id)) {
      add(byId.get(edge.from)?.columns, node.kind === "JOIN" && edge.to_port ? `${edge.to_port}.` : "");
    }
    return { columns, where: `la entrada de ${node.kind} ${node.id}` };
  }
  if (ast.linear) {
    const previous = graph.nodes.filter((n) => n.end.line < line).at(-1);
    if (previous) {
      add(previous.columns);
      return { columns, where: `la salida de ${previous.kind} ${previous.id}` };
    }
  }
  for (const n of graph.nodes) add(n.columns);
  return { columns, where: `el pipeline ${graph.name}` };
}

function hover(model, position) {
  if (insideStringOrComment(model, position)) return null;
  const word = model.getWordAtPosition(position);
  if (!word) return null;
  const range = new monacoApi.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
  const help = etlHelpMarkdown(word.word);
  if (help) return { range, contents: [{ value: help }] };

  const line = model.getLineContent(position.lineNumber);
  const qualifier = /\b(left|right)\.$/.exec(line.slice(0, word.startColumn - 1));
  const name = qualifier ? `${qualifier[1]}.${word.word}` : word.word;
  const context = columnsAt(position.lineNumber);
  const column = context?.columns.find((c) => c.name === name);
  if (column) {
    return { range, contents: [{ value: `**${name}** · columna\n\n\`${typeText(column)}\` · en ${context.where}` }] };
  }
  const found = state.lastValid && pipelineAt(state.lastValid, position.lineNumber);
  const node = found?.graph.nodes.find((n) => n.origin.includes(word.word));
  if (node) {
    const parts = [`**${word.word}** · ${node.kind}`];
    if (node.label) parts.push("```etl\n" + node.label + "\n```");
    if (node.schema) parts.push(`Esquema de salida: \`${node.schema}\``);
    return { range, contents: parts.map((value) => ({ value })) };
  }
  return null;
}

// «¿Quisiste decir…?» para E_COLUMN: el mensaje del compilador trae las columnas que faltan y las disponibles.
function pythonList(text) {
  return [...text.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2]);
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return row[b.length];
}

function closest(name, available) {
  const lower = name.toLowerCase();
  return available
    .map((candidate) => ({ candidate, score: distance(lower, candidate.toLowerCase()) }))
    .filter(({ score }) => score <= Math.max(1, Math.floor(name.length / 3)))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/? \t";

// Formatos del mensaje: "Columna inexistente: x; disponibles: [...]" (typecheck, sobre la columna),
// "Columnas inexistentes: ['x']; disponibles: [...]" (typecheck, sobre la operación) y el mismo en
// minúsculas del runtime, que solo trae la línea de la declaración.
function columnFixes(d) {
  if (d.code !== "E_COLUMN") return [];
  const match = /inexistentes?: (\[.*?\]|[^;]+); disponibles: \[(.*?)\]/i.exec(d.message);
  if (!match) return [];
  const missing = match[1].startsWith("[") ? pythonList(match[1]) : [match[1].trim()];
  const available = pythonList(match[2]);
  const model = editor.getModel();
  let scope = new monacoApi.Range(d.start.line, d.start.column, d.end.line, d.end.column);
  if (d.stage === "runtime") {
    // El runtime no conoce el final de la declaración: se toma del grafo del último análisis.
    const node = state.lastValid?.ir.before?.pipelines.flatMap((p) => p.nodes)
      .find((n) => n.start.line === d.start.line && n.start.column === d.start.column);
    if (node) scope = new monacoApi.Range(node.start.line, node.start.column, node.end.line, node.end.column);
  }
  return missing.flatMap((name) => {
    const ranges = model.findMatches(name, scope, false, true, WORD_SEPARATORS, false).map((m) => m.range);
    const options = closest(name, available);
    return ranges.length && options.length ? [{ name, ranges, options }] : [];
  });
}

function applyFix(fix, option) {
  editor.executeEdits("etl-quick-fix", fix.ranges.map((range) => ({ range, text: option })));
  editor.focus();
}

function codeActions(model, _range, context) {
  const actions = [];
  for (const marker of context.markers) {
    const d = state.result?.diagnostics.find((x) => x.code === marker.code
      && x.start.line === marker.startLineNumber && x.start.column === marker.startColumn);
    if (!d) continue;
    for (const fix of columnFixes(d)) {
      for (const option of fix.options) {
        actions.push({
          title: `Cambiar ${fix.name} por ${option}`, kind: "quickfix", diagnostics: [marker],
          isPreferred: option === fix.options[0],
          edit: { edits: fix.ranges.map((range) => ({
            resource: model.uri, versionId: model.getVersionId(), textEdit: { range, text: option },
          })) },
        });
      }
    }
  }
  return { actions, dispose() {} };
}

function spanRange(span) {
  return new monacoApi.Range(span.start.line, span.start.column, span.end.line, span.end.column);
}

// focus = false deja el foco donde está (por ejemplo, en el árbol que se navega con el teclado).
function selectSpan(span, focus = true) {
  if (!span || !span.start) return;
  const range = spanRange(span);
  editor.setSelection(range);
  editor.revealRangeInCenter(range);
  if (focus) editor.focus();
}

// Resalta sin seleccionar el rango de un nodo bajo el cursor (null lo quita).
let previewDecorations;
function previewSpan(span) {
  previewDecorations ??= editor.createDecorationsCollection();
  if (!span?.start) { previewDecorations.clear(); return; }
  const range = spanRange(span);
  previewDecorations.set([{ range, options: { className: "span-preview" } }]);
  editor.revealRangeInCenterIfOutsideViewport(range);
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
  if (result.ir.before) state.lastValid = result;
  const diagnostics = result.diagnostics;
  monacoApi.editor.setModelMarkers(editor.getModel(), "etl", diagnostics.map((d) => ({
    ...markerRange(d), severity: monacoApi.MarkerSeverity.Error, message: d.message, code: d.code,
  })));
  if (diagnostics.length) {
    const stage = STAGES[diagnostics[0].stage] ?? diagnostics[0].stage;
    setStatus(`${diagnostics.length} error${diagnostics.length > 1 ? "es" : ""} de ${stage}`, "error");
  } else {
    setStatus("Sin errores", "ok");
  }
  renderProblems(diagnostics);
  renderGraph();
  renderTokens();
  views.tree.update(result.tree, result.ast);
  views.ast.update(result.tree, result.ast);
  $("#ir-before").textContent = result.ir.before?.text ?? "La IR se genera cuando sintaxis y estructura son válidas.";
  $("#ir-after").textContent = result.ir.after?.text ?? "La IR optimizada se genera cuando no hay errores de tipos.";
  renderIrChanges();
  codeViewer.setValue(result.code ?? "# El código se genera cuando el programa no tiene errores.");
  $("#save-python").disabled = !result.code;
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
    for (const fix of columnFixes(d)) {
      const suggestion = element("div", { class: "fix" });
      suggestion.append(element("span", {}, `¿Quisiste decir? ${fix.name} →`));
      for (const option of fix.options) {
        const apply = element("button", { type: "button", "aria-label": `Cambiar ${fix.name} por ${option}` }, option);
        apply.addEventListener("click", () => applyFix(fix, option));
        suggestion.append(apply);
      }
      item.append(suggestion);
    }
    list.append(item);
  }
}

// Cambios del optimizador: comparación de la IR antes y después de los pases.
// Se describe el efecto en la IR (eliminado, fusionado, simplificado); `origin` dice qué nodos
// originales forman cada nodo optimizado.

const TERMINAL = new Set(["SINK", "OUTPUT", "USE"]);

function reachesTerminal(pipeline, id) {
  const next = new Map(pipeline.nodes.map((n) => [n.id, []]));
  for (const edge of pipeline.edges) next.get(edge.from).push(edge.to);
  const kind = new Map(pipeline.nodes.map((n) => [n.id, n.kind]));
  const seen = new Set();
  const visit = (node) => {
    if (TERMINAL.has(kind.get(node))) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    return next.get(node).some(visit);
  };
  return visit(id);
}

// { pipeline: { before: Map(id -> estado), after: Map(id -> estado), items: [...] } }
function optimizerChanges(ir) {
  const changes = new Map();
  if (!ir?.before || !ir?.after) return changes;
  for (const before of ir.before.pipelines) {
    const after = ir.after.pipelines.find((p) => p.name === before.name);
    if (!after) continue;
    const owner = new Map();
    for (const node of after.nodes) for (const name of node.origin) owner.set(name, node);
    const original = new Map(before.nodes.map((n) => [n.id, n]));
    const entry = { before: new Map(), after: new Map(), items: [] };
    for (const node of before.nodes) {
      if (owner.has(node.id)) continue;
      entry.before.set(node.id, "removed");
      const reason = !reachesTerminal(before, node.id) ? "no llega a ningún SINK, OUTPUT ni USE"
        : node.kind === "FILTER" ? "su condición siempre es verdadera" : "no cambia el resultado";
      entry.items.push({ kind: "removed", text: `${node.kind} ${node.id}`, detail: reason });
    }
    for (const node of after.nodes) {
      if (node.origin.length > 1) {
        entry.after.set(node.id, "fused");
        for (const name of node.origin) entry.before.set(name, "fused");
        entry.items.push({ kind: "fused", text: `${node.origin.join(" + ")} → ${node.kind} ${node.id}`,
          detail: node.label });
      } else {
        const previous = original.get(node.origin[0]);
        if (previous && previous.label !== node.label) {
          entry.after.set(node.id, "changed");
          entry.before.set(previous.id, "changed");
          entry.items.push({ kind: "changed", text: `${node.kind} ${node.id}`,
            detail: `${previous.label}  ⟶  ${node.label}` });
        }
      }
    }
    changes.set(before.name, entry);
  }
  return changes;
}

const CHANGE_LABELS = { removed: "Eliminado", fused: "Fusionado", changed: "Simplificado" };

// Diferencia por líneas (LCS). Ignora el relleno de espacios que alinea los "=" de la IR textual.
function diffLines(before, after) {
  const key = (line) => line.replace(/\s+/g, " ").trim();
  const a = before.split("\n"), b = after.split("\n");
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = key(a[i]) === key(b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const removed = new Set(), added = new Set();
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) { i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) removed.add(i++);
    else added.add(j++);
  }
  while (i < a.length) removed.add(i++);
  while (j < b.length) added.add(j++);
  return { a, b, removed, added };
}

// Diferencia de la IR de un resultado, calculada una vez (la usan la pestaña IR y el grafo).
const irDiffs = new WeakMap();
function irDiff(ir) {
  if (!irDiffs.has(ir)) irDiffs.set(ir, diffLines(ir.before.text, ir.after.text));
  return irDiffs.get(ir);
}

function irUnchanged(ir) {
  if (!ir?.before?.text || !ir?.after?.text) return false;
  const { removed, added } = irDiff(ir);
  return !removed.size && !added.size;
}

function fillCode(target, lines, marked, cls) {
  target.replaceChildren(...lines.map((line, index) =>
    element("span", { class: marked.has(index) ? `line ${cls}` : "line" }, line || " ")));
}

function renderIrChanges() {
  const ir = state.result?.ir;
  const box = $("#ir-changes");
  const before = ir?.before?.text, after = ir?.after?.text;
  // Si los pases no cambiaron la IR, una sola columna: comparar dos textos iguales no aporta nada.
  const same = irUnchanged(ir);
  if (before && after) {
    const { a, b, removed, added } = irDiff(ir);
    fillCode($("#ir-before"), a, removed, "del");
    fillCode($("#ir-after"), b, added, "add");
  }
  const passes = (state.result?.passes ?? []).map((name) => PASS_LABELS[name] ?? name);
  $("#ir-before-column").hidden = same;
  $("#ir-after-title").textContent = same ? "IR" : "Después de optimizar";
  $("#ir-same").hidden = !same;
  $("#ir-same").textContent = passes.length
    ? `Los pases aplicados (${passes.join(", ")}) no cambiaron la IR de este programa.`
    : "Sin pases (-O0): la IR no se optimiza.";
  if (!ir?.before || !ir?.after || same) { box.hidden = true; return; }
  box.replaceChildren(element("h2", {}, "Qué cambió el optimizador"));
  box.append(element("p", { class: "hint" },
    `Pases aplicados: ${passes.join(", ")}. En el texto: rojo = sale de la IR, verde = entra.`));
  const list = element("ul");
  for (const [pipeline, entry] of optimizerChanges(ir)) {
    for (const item of entry.items) {
      const li = element("li");
      li.append(element("span", { class: `tag ${item.kind}` }, CHANGE_LABELS[item.kind]),
        element("code", {}, item.text));
      if (ir.after.pipelines.length > 1) li.append(element("span", { class: "hint" }, ` · ${pipeline}`));
      if (item.detail) li.append(element("div", { class: "detail" }, item.detail));
      list.append(li);
    }
  }
  box.append(list);
  box.hidden = false;
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
  // Sin cambios del optimizador, "Antes" y "Después" son el mismo grafo: se desactiva la elección.
  const unchanged = irUnchanged(ir);
  document.querySelectorAll("[data-version]").forEach((button) => {
    button.disabled = unchanged;
    button.title = unchanged ? "Los pases no cambiaron la IR de este programa" : "";
    button.setAttribute("aria-pressed", String(button.dataset.version === (unchanged ? "after" : state.version)));
  });
  const version = (unchanged || state.version === "after") && ir?.after ? ir.after : ir?.before;
  if (!version) {
    container.append(element("p", { class: "empty" }, "El grafo aparece cuando sintaxis y estructura son válidas."));
    return;
  }
  if (!container.clientWidth) return;  // pestaña oculta: se dibuja al mostrarla
  const available = container.clientWidth - 2 * NODE.pad;
  const changes = optimizerChanges(ir);
  const side = version === ir.after ? "after" : "before";
  const shown = new Set();
  for (const pipeline of version.pipelines) {
    const title = element("h3", {}, pipeline.name);
    if (pipeline.root) title.append(" ", element("small", {}, "· raíz"));
    // De arriba hacia abajo solo si el grafo horizontal no cabe en el panel.
    const vertical = layout(pipeline, false).width > available;
    const marks = changes.get(pipeline.name)?.[side] ?? new Map();
    for (const kind of marks.values()) shown.add(kind);
    container.append(title, drawPipeline(pipeline, vertical, marks));
  }
  renderLegend(shown, side);
}

function renderLegend(kinds, side) {
  const legend = $("#graph-legend");
  const text = {
    removed: "Eliminado por el optimizador",
    fused: side === "before" ? "Se fusiona con otro paso" : "Fusión de varios pasos",
    changed: "Expresión simplificada",
  };
  legend.replaceChildren(...[...kinds].map((kind) => {
    const item = element("span", { class: `mark ${kind}` });
    item.append(element("i", { "aria-hidden": "true" }), text[kind]);
    return item;
  }));
  legend.hidden = !kinds.size;
}

function drawPipeline(pipeline, vertical, marks = new Map()) {
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
    const mark = marks.get(node.id);
    const group = svg("g", { class: mark ? `node ${mark}` : "node", transform: `translate(${x},${y})`, tabindex: "0",
      role: "button", "aria-label": `${node.kind} ${node.id}${mark ? ` (${CHANGE_LABELS[mark].toLowerCase()})` : ""}` });
    const details = [node.label, node.schema].filter(Boolean).join("\n");
    // El nombre usa el ancho que deja la etiqueta del tipo de nodo.
    const nameChars = Math.floor((NODE.width - 34 - node.kind.length * CHAR_WIDTH.kind) / CHAR_WIDTH.name);
    group.append(svg("title", {}, `${node.origin.join(" + ")}${mark ? ` · ${CHANGE_LABELS[mark]}` : ""}\n${details}`),
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

// Tokens

// Categoría visual de un token: palabra clave, nombre, valor o símbolo.
function tokenCategory(token) {
  if (token.kind === "NAME") return "name";
  if (["NUMBER", "STRING", "TRUE", "FALSE", "NULL"].includes(token.kind)) return "literal";
  if (/^[A-Za-z_]+$/.test(token.lexeme)) return "keyword";
  return "symbol";
}

function renderTokens() {
  const container = $("#tokens");
  const select = $("#token-kind");
  const tokens = state.result?.tokens;
  container.replaceChildren();
  if (!tokens) {
    $("#token-count").textContent = "";
    container.append(element("p", { class: "empty" },
      "Hay un error léxico: corrige el carácter marcado en Problemas para ver los tokens."));
    return;
  }
  const kinds = [...new Set(tokens.map((t) => t.kind))].sort();
  const chosen = kinds.includes(select.value) ? select.value : "";
  select.replaceChildren(element("option", { value: "" }, "Todos los tipos"),
    ...kinds.map((kind) => element("option", { value: kind }, kind)));
  select.value = chosen;

  const query = $("#token-query").value.trim().toLowerCase();
  const shown = tokens.map((token, index) => ({ token, index }))
    .filter(({ token }) => (!chosen || token.kind === chosen)
      && (!query || `${token.lexeme} ${token.kind}`.toLowerCase().includes(query)));
  $("#token-count").textContent = `${shown.length} de ${tokens.length} tokens`
    + (shown.length > TOKEN_ROWS ? ` · se muestran los primeros ${TOKEN_ROWS}` : "");

  const table = element("table");
  const head = element("tr");
  for (const title of ["#", "Tipo", "Lexema", "Posición"]) head.append(element("th", { scope: "col" }, title));
  const thead = element("thead");
  thead.append(head);
  const tbody = element("tbody");
  for (const { token, index } of shown.slice(0, TOKEN_ROWS)) {
    const row = element("tr", { tabindex: "0", title: "Ubicar en el programa" });
    row.append(element("td", { class: "num" }, String(index + 1)),
      element("td", { class: `kind t-${tokenCategory(token)}` }, token.kind),
      element("td", { class: "lexeme" }, token.lexeme),
      element("td", { class: "pos" }, `${token.start.line}:${token.start.column}`));
    row.addEventListener("click", () => selectSpan(token));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); selectSpan(token); }
    });
    tbody.append(row);
  }
  table.append(thead, tbody);
  const wrap = element("div", { class: "table-wrap" });
  wrap.append(table);
  container.append(wrap);
}

// AST en texto: la lista desplegable original, que la pestaña AST muestra en su modo «Texto».

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

function renderAst(ast, container) {
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
  if (name === "tree") views.tree.refresh();
  if (name === "ast") views.ast.refresh();
}

// Archivos: abrir un .etl local y descargar el programa o el Python generado.

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = element("a", { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(name) {
  return (name.split("/").pop() || "programa.etl").replace(/\.etl$/i, "") || "programa";
}

function setupFiles() {
  const input = $("#file-input");
  $("#open-file").addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = (await file.text()).replace(/^\uFEFF/, "");
    if (text.length > MAX_SOURCE) {
      setStatus(`El archivo supera ${MAX_SOURCE.toLocaleString("es")} caracteres`, "error");
      return;
    }
    state.fileName = file.name;
    $("#examples").value = "";
    editor.setValue(text);
  });
  $("#save-file").addEventListener("click", () => {
    download(`${baseName(state.fileName)}.etl`, editor.getValue(), "text/plain;charset=utf-8");
  });
  $("#save-python").addEventListener("click", () => {
    const code = state.result?.code;
    if (!code) return;
    // El código importa etl_dsl.runtime: corre en un entorno con este proyecto instalado.
    download(`${baseName(state.fileName)}.py`, code, "text/x-python;charset=utf-8");
  });
}

function setupControls() {
  const callbacks = { select: (span) => selectSpan(span, false), preview: previewSpan };
  views.tree = window.Arboles.create($("#tree"), "parse", callbacks);
  views.ast = window.Arboles.create($("#ast"), "ast", { ...callbacks, text: renderAst });
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
  $("#token-query").addEventListener("input", renderTokens);
  $("#token-kind").addEventListener("change", renderTokens);
  setupFiles();
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
    state.fileName = select.value;
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
    state.fileName = example;
    editor.setValue((await request(`/api/examples/${example}`)).source);
  } else if (stored) {
    editor.setValue(stored);
  }
  compile();
});
