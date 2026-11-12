import { useEffect, useRef } from "react";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  setDiagnostics,
  type Diagnostic as LintDiagnostic,
} from "@codemirror/lint";
import {
  etlCompletion,
  etlHighlight,
  etlInfoPosition,
  etlLanguage,
  etlTheme,
  setSuggestionBasis,
} from "./etl";
import type { Diagnostic } from "../compiler/types";
import { editorDiagnostics } from "../compiler/diagnostics";
import type { ColumnFix, SuggestionBasis } from "./suggestions";
import { setSourcePreview, sourcePreview } from "./preview";

/** Reemplazo pedido desde fuera (corrección de un diagnóstico); `token` distingue pedidos iguales. */
export type EditorEdit = {
  from: number;
  to: number;
  expected: string;
  insert: string;
  token: number;
};

/** Sustituye el intervalo exacto solo si aún contiene el texto diagnosticado; queda en el historial de deshacer. */
function replaceExact(
  view: EditorView,
  from: number,
  to: number,
  expected: string,
  insert: string,
) {
  if (to > view.state.doc.length || view.state.sliceDoc(from, to) !== expected)
    return false;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    userEvent: "input.replace",
    scrollIntoView: true,
  });
  return true;
}

type Props = {
  value: string;
  onChange(v: string): void;
  onRun?(): void;
  diagnostics?: Diagnostic[];
  /** Correcciones alineadas con `diagnostics` (null si no hay). */
  fixes?: (ColumnFix | null)[];
  label: string;
  focusRange?: { from: number; to: number; token: number };
  previewRange?: { from: number; to: number } | null;
  /** Último análisis válido del documento para las sugerencias; nunca provoca una compilación. */
  basis?: SuggestionBasis | null;
  edit?: EditorEdit;
};

/** CodeMirror 6 con el lenguaje ETL-DSL. Tab indenta; Esc y luego Tab salen del editor. */
export function Editor({
  value,
  onChange,
  onRun,
  diagnostics = [],
  fixes,
  label,
  focusRange,
  previewRange,
  basis = null,
  edit,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const attributes = useRef(new Compartment());
  const replacing = useRef(false);
  const cb = useRef({ onChange, onRun });
  cb.current = { onChange, onRun };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          sourcePreview,
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ icons: false, positionInfo: etlInfoPosition }),
          etlLanguage,
          etlCompletion,
          etlHighlight,
          etlTheme,
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: () => (cb.current.onRun?.(), true) },
            ]),
          ),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          attributes.current.of(
            EditorView.contentAttributes.of({ "aria-label": label }),
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !replacing.current)
              cb.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reemplazo externo del documento (cambiar de ejemplo, aplicar una corrección).
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setSourcePreview.of(previewRange ?? null) });
  }, [previewRange]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value.replace(/\r\n?/g, "\n")) {
      replacing.current = true;
      try {
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: value },
        });
      } finally {
        replacing.current = false;
      }
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const text = v.state.doc.toString();
    const marks: LintDiagnostic[] = diagnostics.flatMap((d, i) =>
      editorDiagnostics(text, [d]).map((mark) => {
        const fix = fixes?.[i];
        return fix
          ? {
              ...mark,
              actions: fix.replacements.map((insert) => ({
                name: `¿Quisiste decir ${insert}?`,
                apply: (view: EditorView, from: number, to: number) => {
                  replaceExact(view, from, to, fix.expected, insert);
                },
              })),
            }
          : mark;
      }),
    );
    v.dispatch(setDiagnostics(v.state, marks));
  }, [diagnostics, fixes]);

  useEffect(() => {
    view.current?.dispatch({ effects: setSuggestionBasis.of(basis) });
  }, [basis]);

  useEffect(() => {
    const v = view.current;
    if (!v || !edit) return;
    if (replaceExact(v, edit.from, edit.to, edit.expected, edit.insert))
      v.focus();
  }, [edit]);

  useEffect(() => {
    const v = view.current;
    if (v)
      v.dispatch({
        effects: attributes.current.reconfigure(
          EditorView.contentAttributes.of({ "aria-label": label }),
        ),
      });
  }, [label]);

  useEffect(() => {
    const v = view.current;
    if (!v || !focusRange) return;
    const from = Math.min(focusRange.from, v.state.doc.length);
    const to = Math.min(focusRange.to, v.state.doc.length);
    v.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    v.focus();
  }, [focusRange]);

  return <div className="cm-host" ref={host} />;
}

export default Editor;
