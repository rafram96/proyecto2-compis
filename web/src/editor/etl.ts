/**
 * Lenguaje ETL-DSL v0.2 para CodeMirror 6. Las palabras salen de etl_dsl/grammar.lark;
 * los colores son los tokens --syn-* de brand.css, así que el editor sigue al tema sin recrearse.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import {
  completeFromList,
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
} from "@codemirror/autocomplete";
import { StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { ATOMS, CLAUSES, CONNECTORS, DECLS, FUNCS, LOGIC, OPERATIONS, TYPES } from "./words";
import { suggest, type Section, type Suggestion, type SuggestionBasis } from "./suggestions";

const KEYWORD = new Set<string>([...DECLS, ...CLAUSES, ...LOGIC]);
const OPERATION = new Set<string>(OPERATIONS.map(([o]) => o));
const ATOM = new Set(ATOMS);
const TYPE = new Set(TYPES);
const BUILTIN = new Set([...CONNECTORS, ...FUNCS]);
const NAMES_DEFINITION = new Set(["PIPELINE", "STEP", "SOURCE", "SINK", "USE", "INPUT", "OUTPUT", "AS"]);

type State = { define: boolean };

export const etlLanguage = StreamLanguage.define<State>({
  name: "etl-dsl",
  startState: () => ({ define: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
    if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
    if (stream.match("->")) return "operator";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current();
      if (state.define && !KEYWORD.has(w)) {
        state.define = false;
        return "def";
      }
      state.define = NAMES_DEFINITION.has(w);
      if (KEYWORD.has(w)) return "keyword";
      if (OPERATION.has(w)) return "typeName";
      if (ATOM.has(w)) return "atom";
      if (TYPE.has(w)) return "typeName";
      if (BUILTIN.has(w)) return "builtin";
      return "variableName";
    }
    if (stream.match(/^(?:==|!=|<=|>=|[<>=+\-*/?])/)) return "operator";
    stream.next();
    return "punctuation";
  },
  languageData: {
    commentTokens: { line: "//" },
    closeBrackets: { brackets: ["(", "{", "[", '"'] },
  },
});

const completions: Completion[] = [
  ...DECLS.map((label) => ({ label, type: "keyword", detail: "declaración" })),
  ...OPERATIONS.map(([label, info]) => ({ label, type: "class", detail: "operación", info })),
  ...CLAUSES.concat(LOGIC).map((label) => ({ label, type: "keyword" })),
  ...ATOMS.map((label) => ({ label, type: "constant" })),
  ...TYPES.map((label) => ({ label, type: "type" })),
  ...CONNECTORS.map((label) => ({ label, type: "function", detail: "conector" })),
  ...FUNCS.map((label) => ({ label, type: "function", detail: "función" })),
];

/** Último análisis válido del documento. Se cambia con un efecto: el editor no se recrea. */
export const setSuggestionBasis = StateEffect.define<SuggestionBasis | null>();
export const suggestionBasis = StateField.define<SuggestionBasis | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSuggestionBasis)) value = effect.value;
    return value;
  },
});

const vocabulary = completeFromList(completions);
const sections = new Map<string, CompletionSection>();
/** Encabezado con título y procedencia (análisis vigente o último válido); la identidad agrupa las opciones. */
function sectionOf({ title, note, rank }: Section): CompletionSection {
  const name = `${title} | ${note}`;
  let section = sections.get(name);
  if (!section) {
    section = {
      name,
      rank,
      header() {
        const header = document.createElement("completion-section");
        header.className = "cm-suggestSection";
        const strong = header.appendChild(document.createElement("strong"));
        strong.textContent = title;
        const small = header.appendChild(document.createElement("small"));
        small.textContent = note;
        return header;
      },
    };
    sections.set(name, section);
  }
  return section;
}

/** `boost` conserva el orden del análisis (posición de la columna, orden de declaración) en lugar del alfabético. */
function option(s: Suggestion, index: number): Completion {
  const insert = s.insert ?? s.label;
  return {
    label: s.label,
    boost: Math.max(-99, 99 - index),
    type: s.type,
    detail: s.detail,
    info: s.info,
    section: sectionOf(s.section),
    apply(view, completion, from, to) {
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + (s.cursor ?? insert.length) },
        userEvent: "input.complete",
        scrollIntoView: true,
        annotations: pickedCompletion.of(completion),
      });
      if (s.reopen) startCompletion(view);
    },
  };
}

/**
 * Sugerencias del programa (columnas, declaraciones, puertos, pipelines, conectores, opciones y aridad) más el
 * vocabulario de siempre. Solo lee el estado del editor; nunca solicita una compilación.
 */
function etlSource(context: CompletionContext): CompletionResult | null {
  const basis = context.state.field(suggestionBasis, false) ?? null;
  const result = suggest(context.state.doc.toString(), context.pos, basis, context.explicit);
  const plain = vocabulary(context) as CompletionResult | null;
  if (!result) return plain;
  const options = result.options.map((s, i) => option(s, i));
  if (!result.exclusive && plain) {
    const taken = new Set(options.map((o) => o.label));
    const section = sectionOf({ title: "Vocabulario", note: result.notice ?? "palabras del lenguaje", rank: 9 });
    for (const o of plain.options) if (!taken.has(o.label)) options.push({ ...o, section });
  }
  return options.length ? { from: result.from, options, validFor: /^\w*$/ } : null;
}

export const etlCompletion = [suggestionBasis, etlLanguage.data.of({ autocomplete: etlSource })];

type Rect = { left: number; right: number; top: number; bottom: number };
/**
 * Panel de información junto a la lista si cabe; si no (móvil), entero encima o debajo de ella. El modo estrecho de
 * CodeMirror lo superponía a las opciones y tapaba el encabezado con la procedencia del análisis.
 */
export function etlInfoPosition(_view: EditorView, list: Rect, option: Rect, info: Rect, space: Rect) {
  const width = info.right - info.left;
  const height = info.bottom - info.top;
  const right = space.right - list.right;
  const left = list.left - space.left;
  if (width <= right || width <= left) {
    const top = Math.max(space.top, Math.min(option.top, space.bottom - height)) - list.top;
    return {
      style: `top: ${top}px; max-width: ${Math.min(400, Math.max(right, left))}px`,
      class: width <= right ? "cm-completionInfo-right" : "cm-completionInfo-left",
    };
  }
  // Ancho fijo: el medido corresponde a la disposición anterior y no permitiría ajustar el desplazamiento.
  const shown = Math.min(400, space.right - space.left - 16);
  const shift = Math.max(space.left + 8 - list.left, Math.min(0, space.right - 8 - list.left - shown));
  const above = list.top - space.top >= height || list.top - space.top > space.bottom - list.bottom;
  return {
    style: `${above ? "bottom" : "top"}: 100%; left: ${shift}px; width: ${shown}px; max-width: ${shown}px`,
    class: `cm-completionInfo-stacked cm-completionInfo-${above ? "above" : "below"}`,
  };
}

export const etlHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.keyword, color: "var(--syn-keyword)", fontWeight: "500" },
    { tag: t.typeName, color: "var(--syn-keyword)" },
    { tag: t.definition(t.variableName), color: "var(--syn-fn)", fontWeight: "500" },
    { tag: [t.string], color: "var(--syn-string)" },
    { tag: [t.number, t.atom, t.bool], color: "var(--syn-number)" },
    { tag: t.comment, color: "var(--syn-comment)", fontStyle: "italic" },
    { tag: [t.standard(t.variableName), t.function(t.variableName)], color: "var(--syn-fn)" },
    { tag: t.operator, color: "var(--foreground)" },
  ]),
);

/** Tema del editor: todo por variables CSS, así el cambio claro/oscuro no recrea la vista. */
export const etlTheme = EditorView.theme({
  "&": { color: "var(--card-foreground)", backgroundColor: "var(--card)", fontSize: "0.875rem", height: "100%" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65" }, // taste-skill-ignore: es el editor de código
  ".cm-content": { caretColor: "var(--foreground)", padding: "14px 0" },
  ".cm-gutters": {
    backgroundColor: "var(--card)",
    color: "var(--syn-comment)",
    border: "none",
    paddingLeft: "6px",
    fontFamily: "var(--font-sans)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--surface) 70%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--brand-cyan) 32%, transparent) !important",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--card)",
    color: "var(--card-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    boxShadow: "0 12px 32px rgba(3, 10, 30, 0.22)",
    fontFamily: "var(--font-sans)",
    overflow: "hidden",
  },
  // El panel de información se coloca fuera de la lista: recortarlo lo ocultaba (o lo partía en móvil).
  ".cm-tooltip.cm-tooltip-autocomplete": { overflow: "visible" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--brand-amber)", color: "var(--brand-ink)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", borderRadius: "5px" }, // taste-skill-ignore: sugerencias de código
  ".cm-completionDetail": { fontFamily: "var(--font-sans)", opacity: "0.75", marginLeft: "1em", fontStyle: "normal" },
  ".cm-tooltip-autocomplete > ul > completion-section.cm-suggestSection": {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
    padding: "6px 10px 4px",
    borderBottom: "1px solid var(--border)",
    opacity: "1",
    fontFamily: "var(--font-sans)",
    lineHeight: "1.3",
  },
  ".cm-suggestSection strong": { fontSize: "0.8125rem", fontWeight: "600" },
  ".cm-suggestSection small": { fontSize: "0.75rem", color: "var(--muted-foreground)" },
  ".cm-completionInfo-above": { marginBottom: "4px" },
  ".cm-completionInfo-below": { marginTop: "4px" },
  ".cm-tooltip.cm-completionInfo": { maxWidth: "22rem", padding: "8px 12px", fontSize: "0.8125rem", lineHeight: "1.45" },
  ".cm-diagnosticAction": {
    backgroundColor: "var(--brand-amber)",
    color: "var(--brand-ink)",
    border: "none",
    borderRadius: "4px",
    padding: "4px 10px",
    marginLeft: "8px",
    font: "600 0.8125rem var(--font-sans)",
    cursor: "pointer",
  },
  ".cm-diagnosticAction:focus-visible": { outline: "2px solid var(--foreground)", outlineOffset: "2px" },
  ".cm-diagnostic": { padding: "8px 12px", fontSize: "0.875rem" },
  ".cm-diagnostic-error": { borderLeft: "4px solid var(--destructive)" },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "4px",
    textDecorationSkipInk: "none",
  },
  ".cm-lint-marker-error": { content: "none" },
});
