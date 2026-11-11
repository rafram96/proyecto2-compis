/**
 * Lenguaje ETL-DSL v0.2 para CodeMirror 6. Las palabras salen de etl_dsl/grammar.lark;
 * los colores son los tokens --syn-* de brand.css, así que el editor sigue al tema sin recrearse.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { completeFromList, type Completion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { ATOMS, CLAUSES, CONNECTORS, DECLS, FUNCS, LOGIC, OPERATIONS, TYPES } from "./words";

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

export const etlCompletion = etlLanguage.data.of({ autocomplete: completeFromList(completions) });

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
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--brand-amber)", color: "var(--brand-ink)" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" }, // taste-skill-ignore: sugerencias de código
  ".cm-completionDetail": { fontFamily: "var(--font-sans)", opacity: "0.75", marginLeft: "1em", fontStyle: "normal" },
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
