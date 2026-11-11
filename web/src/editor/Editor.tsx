import { useEffect, useRef } from "react";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { etlCompletion, etlHighlight, etlLanguage, etlTheme } from "./etl";
import type { Diagnostic } from "../compiler/types";
import { editorDiagnostics } from "../compiler/diagnostics";

type Props = {
  value: string;
  onChange(v: string): void;
  onRun?(): void;
  diagnostics?: Diagnostic[];
  label: string;
};

/** CodeMirror 6 con el lenguaje ETL-DSL. Tab indenta; Esc y luego Tab salen del editor. */
export function Editor({ value, onChange, onRun, diagnostics = [], label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
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
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ icons: false }),
          etlLanguage,
          etlCompletion,
          etlHighlight,
          etlTheme,
          Prec.highest(keymap.of([{ key: "Mod-Enter", run: () => (cb.current.onRun?.(), true) }])),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
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
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (v) v.dispatch(setDiagnostics(v.state, editorDiagnostics(v.state.doc.toString(), diagnostics)));
  }, [diagnostics]);

  return <div className="cm-host" ref={host} />;
}

export default Editor;
