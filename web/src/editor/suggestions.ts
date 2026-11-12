/**
 * Sugerencias del editor a partir del análisis del compilador (contrato 4).
 *
 * Reparto de responsabilidades:
 * - El *lugar* del cursor (pipeline, STEP/FLOW, cláusula, paréntesis) se reconoce léxicamente sobre el texto actual.
 *   No decide validez ni tipos: solo dice qué clase de nombre cabe ahí.
 * - El *contenido* (columnas, declaraciones, puertos, pipelines) sale del último análisis válido del documento:
 *   `schemas` (IR original), las entradas de `ir_before` y las declaraciones del `ast`. Nada se infiere en TS.
 * - Conectores, opciones y aridad son vocabulario del compilador (`words.ts`), contrastado con el núcleo en las pruebas.
 *
 * Este módulo no compila ni importa el cliente del compilador: pedir sugerencias nunca genera trabajo en el worker.
 */
import type { AnalysisResult, InferredColumn, InferredSchema } from "../compiler/types.ts";
import { editorDiagnostics } from "../compiler/diagnostics.ts";
import type { Diagnostic } from "../compiler/types.ts";
import { AGGREGATE_ARITY, CONNECTOR_SPECS, SCALAR_ARITY } from "./words.ts";
import type { Arity } from "./words.ts";

/** Último análisis del documento con `ast`, `ir_before` y `schemas` disponibles, y el texto exacto analizado. */
export type SuggestionBasis = {
  documentId: string;
  revision: number;
  source: string;
  analysis: AnalysisResult;
};

export function usableAnalysis(analysis: AnalysisResult | null | undefined): analysis is AnalysisResult {
  return (
    !!analysis &&
    analysis.artifacts.ast.status === "available" &&
    analysis.artifacts.ir_before.status === "available" &&
    analysis.artifacts.schemas.status === "available"
  );
}

/**
 * Decide la base tras aceptar un resultado vigente. Un análisis con errores sintácticos, estructurales o semánticos
 * no la sustituye: se conserva la anterior del mismo documento («último análisis válido»). Otro documento la descarta.
 */
export function nextBasis(previous: SuggestionBasis | null, incoming: SuggestionBasis): SuggestionBasis | null {
  if (previous && previous.documentId === incoming.documentId && previous.revision > incoming.revision) return previous;
  if (usableAnalysis(incoming.analysis)) return incoming;
  return previous?.documentId === incoming.documentId ? previous : null;
}

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

/** Estado de la base respecto del texto del editor: vigente si analizó exactamente este texto. */
export function basisNote(basis: SuggestionBasis, text: string) {
  return normalize(basis.source) === normalize(text)
    ? { current: true, text: `Análisis vigente · revisión ${basis.revision}` }
    : { current: false, text: `Último análisis válido · revisión ${basis.revision}; el texto cambió después` };
}

// ---------------------------------------------------------------------------------------------------------------
// Contexto léxico del cursor

type Token = { t: string; kind: "name" | "number" | "string" | "punct" };
type Frame = { open: string; head: Token[]; body: Token[] };

const OPEN: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const CLOSE = new Set(["}", ")", "]"]);

/** Tokens hasta `end`, o `null` si `end` cae dentro de un comentario o una cadena. */
function lex(text: string, end: number): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < end) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl < 0 ? text.length : nl;
      if (end <= stop) return null;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      // Cursor dentro de la cadena (también de una sin cerrar en su línea): no se sugiere nada.
      if (end <= j) return null;
      const closed = text[j] === '"';
      tokens.push({ t: text.slice(i, closed ? j + 1 : j), kind: "string" });
      i = closed ? j + 1 : j;
      continue;
    }
    const name = /^[A-Za-z_]\w*/.exec(text.slice(i, Math.min(end, i + 256)));
    if (name) {
      tokens.push({ t: name[0], kind: "name" });
      i += name[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(text.slice(i, Math.min(end, i + 64)));
    if (number) {
      tokens.push({ t: number[0], kind: "number" });
      i += number[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (i + 2 <= end && ["->", "==", "!=", "<=", ">="].includes(two)) {
      tokens.push({ t: two, kind: "punct" });
      i += 2;
      continue;
    }
    tokens.push({ t: c, kind: "punct" });
    i++;
  }
  return tokens;
}

function frames(tokens: Token[]): Frame[] {
  const stack: Frame[] = [{ open: "", head: [], body: [] }];
  for (const token of tokens) {
    const top = stack[stack.length - 1];
    if (token.kind === "punct" && OPEN[token.t]) {
      stack.push({ open: token.t, head: [...top.body], body: [] });
      top.body.push(token);
    } else if (token.kind === "punct" && CLOSE.has(token.t)) {
      if (stack.length > 1 && OPEN[stack[stack.length - 1].open] === token.t) {
        const closed = stack.pop()!;
        const parent = stack[stack.length - 1];
        // STEP, FLOW y PIPELINE terminan con su bloque, sin punto y coma.
        if (closed.open === "{" && ["STEP", "FLOW", "PIPELINE"].includes(closed.head[0]?.t)) parent.body = [];
        else parent.body.push(token);
      } else top.body.push(token);
    } else if (token.kind === "punct" && token.t === ";") top.body = [];
    else top.body.push(token);
  }
  return stack;
}

export type Role = "SOURCE" | "SINK";
export type CursorContext =
  | { kind: "columns"; pipeline: string; step: string; side: "left" | "right" | null; exclude: string[]; functions: boolean }
  | { kind: "qualifier"; pipeline: string; step: string }
  | { kind: "aggregates"; pipeline: string; step: string }
  | { kind: "flow"; pipeline: string; role: "producer" | "consumer"; endpoint: string | null }
  | { kind: "pipelines"; pipeline: string }
  | { kind: "connectors"; role: Role }
  | { kind: "options"; role: Role; connector: string; used: string[] };

const listed = (clause: Token[]) => clause.slice(1).filter((t) => t.kind === "name").map((t) => t.t);
const atListItem = (clause: Token[]) => clause.length === 1 || clause[clause.length - 1].t === ",";

/** Qué clase de nombre cabe en `pos` (antes de la palabra que se escribe). `null`: ningún contexto del programa. */
export function cursorContext(text: string, pos: number): CursorContext | null {
  const tokens = lex(text, pos);
  if (!tokens) return null;
  const stack = frames(tokens);
  const pipeFrame = stack[1];
  if (!pipeFrame || pipeFrame.open !== "{" || pipeFrame.head[0]?.t !== "PIPELINE") return null;
  const pipeline = pipeFrame.head[1]?.t;
  if (!pipeline || pipeFrame.head[1].kind !== "name") return null;
  if (stack.length === 2) {
    const body = pipeFrame.body;
    if (body.length === 1 && body[0].t === "USE") return { kind: "pipelines", pipeline };
    const role = body[0]?.t;
    if ((role === "SOURCE" || role === "SINK") && body[body.length - 1].t === "=")
      return { kind: "connectors", role };
    return null;
  }
  const block = stack[2];
  const head = block.head;
  if (block.open === "(") {
    const role = head[0]?.t;
    const connector = head[head.length - 1]?.t;
    if (stack.length !== 3 || (role !== "SOURCE" && role !== "SINK") || head[head.length - 2]?.t !== "=") return null;
    if (!CONNECTOR_SPECS[connector]) return null;
    const body = block.body;
    if (body.length && body[body.length - 1].t !== ",") return null;
    const used = body.filter((t, i) => t.kind === "name" && body[i + 1]?.t === ":").map((t) => t.t);
    return { kind: "options", role, connector, used };
  }
  if (block.open !== "{") return null;
  if (head[0]?.t === "FLOW") {
    if (stack.length !== 3) return null;
    const body = block.body;
    const last = body[body.length - 1];
    if (last?.t === ".") {
      const endpoint = body[body.length - 2];
      if (endpoint?.kind !== "name") return null;
      const consumer = body.slice(0, -2).some((t) => t.t === "->");
      return { kind: "flow", pipeline, role: consumer ? "consumer" : "producer", endpoint: endpoint.t };
    }
    if (!body.length) return { kind: "flow", pipeline, role: "producer", endpoint: null };
    if (last.t === "->") return { kind: "flow", pipeline, role: "consumer", endpoint: null };
    return null;
  }
  if (head[0]?.t !== "STEP" || head[1]?.kind !== "name" || head[2]?.t !== "=") return null;
  const step = head[1].t;
  const op = head[3]?.t;
  const clause = block.body;
  const first = clause[0]?.t;
  const last = clause[clause.length - 1];
  const columns = (exclude: string[] = [], functions = false, side: "left" | "right" | null = null) =>
    ({ kind: "columns", pipeline, step, side, exclude, functions }) as const;
  if (stack.length > 3) {
    // Dentro de paréntesis: argumentos de función o agrupación de una expresión.
    if (op === "JOIN" || stack.slice(3).some((f) => f.open !== "(")) return null;
    const inner = stack[stack.length - 1].body;
    if (inner[inner.length - 1]?.t === ".") return null;
    if (op === "AGGREGATE" && first !== undefined && first !== "GROUP_BY") return columns([], true);
    if (["FILTER", "DERIVE", "FILL_NULL"].includes(op) && (first === "WHERE" || clause.some((t) => t.t === "=")))
      return columns([], true);
    return null;
  }
  if (last?.t === ".") {
    const qualifier = clause[clause.length - 2]?.t;
    if (op === "JOIN" && first === "ON" && (qualifier === "left" || qualifier === "right"))
      return columns([], false, qualifier);
    return null;
  }
  switch (op) {
    case "FILTER":
      return first === "WHERE" ? columns([], true) : null;
    case "SELECT":
    case "DISTINCT":
    case "DROP_NULLS":
      return first === "COLUMNS" && atListItem(clause) ? columns(listed(clause)) : null;
    case "SORT":
      return first === "BY" && atListItem(clause) ? columns(listed(clause)) : null;
    case "DERIVE":
      return clause.some((t) => t.t === "=") ? columns([], true) : null;
    case "FILL_NULL":
      return clause.length === 0 ? columns() : clause.some((t) => t.t === "=") ? columns([], true) : null;
    case "RENAME":
      return clause.length === 0 ? columns() : null;
    case "AGGREGATE":
      if (clause.length === 0) return { kind: "aggregates", pipeline, step };
      return first === "GROUP_BY" && atListItem(clause) ? columns(listed(clause)) : null;
    case "JOIN":
      return first === "ON" && (clause.length === 1 || last.t === "==" || last.t === "AND")
        ? { kind: "qualifier", pipeline, step }
        : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Consultas al análisis (solo forma del contrato 4, sin reglas semánticas)

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === "object" && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(rec) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function astPipelines(basis: SuggestionBasis): Rec[] {
  const ast = basis.analysis.artifacts.ast;
  return ast.status === "available" && rec(ast.data) ? recs(ast.data.pipelines) : [];
}
function declarations(basis: SuggestionBasis, pipeline: string): Rec[] {
  return recs(astPipelines(basis).find((p) => p.name === pipeline)?.declarations);
}
function irNode(basis: SuggestionBasis, pipeline: string, name: string): Rec | undefined {
  const ir = basis.analysis.artifacts.ir_before;
  if (ir.status !== "available" || !rec(ir.data.module)) return;
  const pipe = recs(ir.data.module.pipelines).find((p) => p.name === pipeline);
  return recs(pipe?.nodes).find((n) => n.name === name);
}

export type KnownColumns = {
  /** Productor según la IR original, con su puerto de salida si lo tiene (`clean.cleaned`). */
  source: string;
  complete: boolean;
  columns: InferredColumn[];
};

/** Columnas de la entrada de `step` (lado `left`/`right` en JOIN) en el último análisis válido. */
export function inputColumns(
  basis: SuggestionBasis,
  pipeline: string,
  step: string,
  side: "left" | "right" | null,
): KnownColumns | null {
  const node = irNode(basis, pipeline, step);
  if (!node || !Array.isArray(node.inputs)) return null;
  const input = node.inputs.find((pair) => Array.isArray(pair) && (pair[0] ?? null) === side);
  if (!Array.isArray(input) || !rec(input[1])) return null;
  const producer = str(input[1].node);
  const port = str(input[1].port);
  const schemas = basis.analysis.artifacts.schemas;
  const schema: InferredSchema | undefined =
    schemas.status === "available" ? schemas.data[pipeline]?.[producer]?.[port] : undefined;
  if (!producer || !schema) return null;
  return { source: port ? `${producer}.${port}` : producer, complete: schema.complete, columns: schema.columns };
}

function usePorts(basis: SuggestionBasis, target: string) {
  const decls = declarations(basis, target);
  return {
    inputs: decls.filter((d) => d.node === "Input").map((d) => str(d.name)),
    outputs: decls.filter((d) => d.node === "Output").map((d) => str(d.name)),
  };
}

const KIND: Record<string, string> = {
  Source: "SOURCE",
  Input: "INPUT",
  Step: "STEP",
  Sink: "SINK",
  Output: "OUTPUT",
  Use: "USE",
};
function operation(decl: Rec) {
  return rec(decl.operation) ? str(decl.operation.node).replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase() : "";
}
function describe(decl: Rec) {
  const kind = KIND[str(decl.node)] ?? str(decl.node).toUpperCase();
  const extra =
    operation(decl) || str(decl.pipeline) || (rec(decl.connector) ? str(decl.connector.name) : "");
  return extra ? `${kind} · ${extra}` : kind;
}

// ---------------------------------------------------------------------------------------------------------------
// Sugerencias

export type Section = { title: string; note: string; rank: number };
export type Suggestion = {
  label: string;
  type: string;
  detail: string;
  info: string;
  section: Section;
  /** Texto insertado si difiere de la etiqueta; `cursor` es la posición final dentro de él. */
  insert?: string;
  cursor?: number;
  /** Volver a abrir la lista tras aceptar (`left.`, `CSV(`, `SUM(`). */
  reopen?: boolean;
};
/** `notice`: explicación cuando no hay columnas que ofrecer (se muestra en el encabezado del vocabulario). */
export type SuggestionResult = { from: number; options: Suggestion[]; exclusive: boolean; notice?: string };

export function typeText(column: InferredColumn) {
  const types = column.types === null ? "tipo desconocido" : column.types.length ? column.types.join(" | ") : "Null";
  return `${types} · ${column.nullable ? "puede ser NULL" : "sin NULL"}`;
}

function arityText({ min, max }: Arity) {
  const word = (n: number) => `${n} argumento${n === 1 ? "" : "s"}`;
  if (max === null) return `${min} o más argumentos`;
  return min === max ? word(min) : `${min} o ${word(max)}`;
}

function functionSuggestions(table: Record<string, Arity>, title: string, rank: number): Suggestion[] {
  const section = { title, note: "vocabulario del compilador", rank };
  return Object.entries(table).map(([name, arity]) => ({
    label: name,
    type: "function",
    detail: arityText(arity),
    info: `${name}: ${arityText(arity)}.`,
    section,
    insert: `${name}()`,
    cursor: name.length + 1,
    reopen: arity.min > 0,
  }));
}

function columnSuggestions(
  basis: SuggestionBasis,
  text: string,
  context: Extract<CursorContext, { kind: "columns" }>,
): Suggestion[] {
  const known = inputColumns(basis, context.pipeline, context.step, context.side);
  if (!known) return [];
  const note = basisNote(basis, text);
  const section: Section = {
    title: `Columnas de ${context.side ? `${context.side} · ` : ""}${known.source}${known.complete ? "" : " · esquema parcial"}`,
    note: note.text,
    rank: 0,
  };
  const partial = known.complete
    ? "Esquema completo según el análisis estático."
    : "Esquema parcial: solo se listan las columnas conocidas; la fuente puede tener otras que el análisis no conoce.";
  return known.columns
    .filter((c) => !context.exclude.includes(c.name))
    .map((column) => ({
      label: column.name,
      type: "variable",
      detail: typeText(column),
      info: `Columna de la entrada de ${context.step}${context.side ? ` (${context.side})` : ""}, producida por ${known.source}. ${partial} ${note.text}.`,
      section,
    }));
}

/** Por qué no hay columnas: nunca se completan con nombres supuestos. */
function missingColumns(
  basis: SuggestionBasis | null,
  text: string,
  context: Extract<CursorContext, { kind: "columns" }>,
) {
  if (!basis) return "Sin columnas: compila sin errores para conocerlas";
  const known = inputColumns(basis, context.pipeline, context.step, context.side);
  const note = basisNote(basis, text);
  if (!known)
    return `Sin columnas: ${context.step} no tiene entrada en el último análisis válido (revisión ${basis.revision})`;
  if (!known.complete && !known.columns.length)
    return `Sin columnas conocidas de ${known.source}: esquema parcial (p. ej. SOURCE sin contrato) · ${note.text}`;
  return `Sin más columnas conocidas de ${known.source} · ${note.text}`;
}

function flowSuggestions(
  basis: SuggestionBasis,
  text: string,
  context: Extract<CursorContext, { kind: "flow" }>,
): Suggestion[] {
  const decls = declarations(basis, context.pipeline);
  const note = basisNote(basis, text).text;
  const out: Suggestion[] = [];
  const producer = context.role === "producer";
  const section: Section = {
    title: producer ? `Productores de ${context.pipeline}` : `Destinos de ${context.pipeline}`,
    note,
    rank: 0,
  };
  const port = (owner: string, name: string, detail: string, full: boolean) =>
    out.push({
      label: full ? `${owner}.${name}` : name,
      type: "property",
      detail,
      info: `Puerto ${name} de ${owner}: ${detail}. ${note}.`,
      section,
    });
  for (const decl of decls) {
    const name = str(decl.name);
    if (!name) continue;
    const kind = str(decl.node);
    const join = kind === "Step" && operation(decl) === "JOIN";
    if (context.endpoint !== null) {
      if (name !== context.endpoint) continue;
      if (kind === "Use") {
        const ports = usePorts(basis, str(decl.pipeline));
        for (const p of producer ? ports.outputs : ports.inputs)
          port(name, p, `${producer ? "OUTPUT" : "INPUT"} de ${str(decl.pipeline)}`, false);
      } else if (join && !producer) for (const side of ["left", "right"]) port(name, side, "entrada del JOIN", false);
      continue;
    }
    if (kind === "Use") {
      const ports = usePorts(basis, str(decl.pipeline));
      for (const p of producer ? ports.outputs : ports.inputs)
        port(name, p, `${producer ? "OUTPUT" : "INPUT"} de ${str(decl.pipeline)}`, true);
      continue;
    }
    if (join && !producer) {
      for (const side of ["left", "right"]) port(name, side, "entrada del JOIN", true);
      continue;
    }
    const fits = producer ? ["Source", "Input", "Step"].includes(kind) : ["Step", "Sink", "Output"].includes(kind);
    if (fits)
      out.push({
        label: name,
        type: "class",
        detail: describe(decl),
        info: `${describe(decl)} declarado en ${context.pipeline}. ${note}.`,
        section,
      });
  }
  return out;
}

function pipelineSuggestions(basis: SuggestionBasis, text: string, current: string): Suggestion[] {
  const note = basisNote(basis, text).text;
  const section: Section = { title: "Pipelines del programa", note, rank: 0 };
  return astPipelines(basis)
    .map((p) => str(p.name))
    .filter((name) => name && name !== current)
    .map((name) => {
      const ports = usePorts(basis, name);
      const detail = `INPUT ${ports.inputs.join(", ") || "ninguno"} · OUTPUT ${ports.outputs.join(", ") || "ninguno"}`;
      return {
        label: name,
        type: "namespace",
        detail,
        info: `Pipeline ${name}. ${detail}. ${note}.`,
        section,
      };
    });
}

function connectorSuggestions(role: Role): Suggestion[] {
  const section = { title: `Conectores de ${role}`, note: "vocabulario del compilador", rank: 0 };
  return Object.entries(CONNECTOR_SPECS)
    .filter(([, spec]) => role === "SOURCE" || spec.sink)
    .map(([name, spec]) => ({
      label: name,
      type: "function",
      detail: spec.sink ? "lectura y escritura" : "solo lectura (SOURCE)",
      info: `${name}: ${spec.options
        .filter((o) => role === "SINK" || !o.sinkOnly)
        .map((o) => `${o.name}${o.required ? " (obligatoria)" : ""}`)
        .join(", ")}.`,
      section,
      insert: `${name}()`,
      cursor: name.length + 1,
      reopen: true,
    }));
}

function optionSuggestions(context: Extract<CursorContext, { kind: "options" }>): Suggestion[] {
  const spec = CONNECTOR_SPECS[context.connector];
  const section = { title: `Opciones de ${context.connector} en ${context.role}`, note: "vocabulario del compilador", rank: 0 };
  return spec.options
    .filter((o) => (context.role === "SINK" || !o.sinkOnly) && !context.used.includes(o.name))
    .map((o) => {
      const bool = o.name === "header";
      return {
        label: o.name,
        type: "property",
        detail: `${o.required ? "obligatoria" : "opcional"} · ${o.value}`,
        info: `${context.connector}.${o.name}: ${o.value}.${o.sinkOnly ? " Solo en SINK." : ""}`,
        section,
        insert: bool ? `${o.name}: ` : `${o.name}: ""`,
        cursor: o.name.length + (bool ? 2 : 3),
      };
    });
}

const QUALIFIERS: Suggestion[] = (["left", "right"] as const).map((side) => ({
  label: `${side}.`,
  type: "keyword",
  detail: side === "left" ? "columna de la entrada izquierda" : "columna de la entrada derecha",
  info: `Calificador de JOIN: solo es válido dentro de ON. Tras el punto se listan las columnas de ${side}.`,
  section: { title: "Calificadores de JOIN", note: "solo dentro de ON", rank: 0 },
  reopen: true,
}));

/**
 * Sugerencias para el cursor `pos` del texto del editor. `explicit` = pedidas con Ctrl+Espacio.
 * `null`: el contexto no es del programa; el editor ofrece solo vocabulario, como antes.
 */
export function suggest(
  text: string,
  pos: number,
  basis: SuggestionBasis | null,
  explicit = false,
): SuggestionResult | null {
  const word = /[A-Za-z_]\w*$/.exec(text.slice(Math.max(0, pos - 256), pos));
  const from = pos - (word ? word[0].length : 0);
  const context = cursorContext(text, from);
  if (!context) return null;
  const previous = text.slice(0, from).trimEnd().slice(-1);
  // Sin palabra, la lista solo aparece sola tras `.` o `(`; Ctrl+Espacio la pide en cualquier lugar.
  if (!explicit && !word && previous !== "." && previous !== "(") return null;
  switch (context.kind) {
    case "connectors":
      return { from, options: connectorSuggestions(context.role), exclusive: true };
    case "options":
      return { from, options: optionSuggestions(context), exclusive: true };
    case "qualifier":
      // La gramática solo admite `left.x == right.y` en ON: el vocabulario no cabe ahí.
      return { from, options: QUALIFIERS, exclusive: true };
    case "aggregates":
      return {
        from,
        options: functionSuggestions(AGGREGATE_ARITY, "Agregaciones", 0),
        exclusive: false,
      };
    case "columns": {
      const columns = basis ? columnSuggestions(basis, text, context) : [];
      const functions = context.functions ? functionSuggestions(SCALAR_ARITY, "Funciones", 1) : [];
      if (context.side) return { from, options: columns, exclusive: true };
      return {
        from,
        options: [...columns, ...functions],
        exclusive: false,
        notice: columns.length ? undefined : missingColumns(basis, text, context),
      };
    }
    case "flow": {
      if (!basis) return null;
      return { from, options: flowSuggestions(basis, text, context), exclusive: true };
    }
    case "pipelines":
      if (!basis) return null;
      return { from, options: pipelineSuggestions(basis, text, context.pipeline), exclusive: true };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// «¿Quisiste decir …?» para E_COLUMN

export type ColumnFix = { from: number; to: number; expected: string; replacements: string[] };

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** Columnas conocidas más cercanas a `name` (máx. 3, todas a la distancia mínima). */
export function closestColumns(name: string, columns: readonly string[]): string[] {
  const limit = Math.max(1, Math.floor(name.length / 3));
  let best = Infinity;
  let found: string[] = [];
  for (const column of new Set(columns)) {
    if (column === name) continue;
    // Una diferencia solo de mayúsculas cuenta menos que cualquier cambio de letra.
    const lower = distance(name.toLowerCase(), column.toLowerCase());
    const score = lower === 0 ? 0.5 : lower;
    if (lower > limit || score > best) continue;
    if (score < best) found = [];
    best = score;
    found.push(column);
  }
  return found.sort().slice(0, 3);
}

/**
 * Corrección para un diagnóstico E_COLUMN del texto actual. Solo si su intervalo es exactamente el identificador
 * (opcionalmente `left.`/`right.`) y la entrada del STEP es conocida en el último análisis válido. No cambia el
 * diagnóstico: devuelve el intervalo (UTF-16, texto con LF) y los reemplazos.
 */
export function columnFix(source: string, diagnostic: Diagnostic, basis: SuggestionBasis | null): ColumnFix | null {
  if (diagnostic.code !== "E_COLUMN" || !basis) return null;
  const text = normalize(source);
  const [range] = editorDiagnostics(text, [diagnostic]);
  if (!range) return null;
  const expected = text.slice(range.from, range.to);
  const match = /^(?:(left|right)\.)?([A-Za-z_]\w*)$/.exec(expected);
  if (!match) return null;
  const context = cursorContext(text, range.from);
  let pipeline = "";
  let step = "";
  if (context?.kind === "columns" && !context.side && !match[1]) ({ pipeline, step } = context);
  else if (context?.kind === "qualifier" && match[1]) ({ pipeline, step } = context);
  else return null;
  const known = inputColumns(basis, pipeline, step, (match[1] as "left" | "right" | undefined) ?? null);
  if (!known) return null;
  const replacements = closestColumns(
    match[2],
    known.columns.map((c) => c.name),
  ).map((name) => (match[1] ? `${match[1]}.${name}` : name));
  return replacements.length ? { from: range.from, to: range.to, expected, replacements } : null;
}
