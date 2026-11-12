import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
export const setSourcePreview = StateEffect.define<{
  from: number;
  to: number;
} | null>();
export const sourcePreview = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) return Decoration.none;
    for (const effect of transaction.effects)
      if (effect.is(setSourcePreview)) {
        const range = effect.value;
        return range &&
          range.to > range.from &&
          range.to <= transaction.state.doc.length
          ? Decoration.set([
              Decoration.mark({ class: "cm-source-preview" }).range(
                range.from,
                range.to,
              ),
            ])
          : Decoration.none;
      }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
