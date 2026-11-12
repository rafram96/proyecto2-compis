import { useCallback, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import {
  clampSplit,
  readLayout,
  splitForKey,
  splitFromPointer,
  SPLIT_DEFAULT,
  SPLIT_MAX,
  SPLIT_MIN,
  writeLayout,
} from "../workspace/layout";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** Proporción confirmada del editor; se guarda solo al terminar un ajuste. */
export function usePanelSplit() {
  const [split, setSplit] = useState(() => readLayout(storage()));
  const commit = useCallback((value: number) => {
    const next = clampSplit(value);
    setSplit(next);
    writeLayout(storage(), next);
  }, []);
  return [split, commit] as const;
}

export const splitStyle = (split: number) =>
  ({
    "--editor-fr": `${split}fr`,
    "--inspector-fr": `${100 - split}fr`,
  }) as CSSProperties;

const valueText = (split: number) =>
  `Editor ${split} %, inspector ${100 - split} %`;

/**
 * Divisor de escritorio entre editor e inspector. Durante el arrastre solo cambia
 * variables CSS del contenedor: React no vuelve a renderizar el estudio ni
 * CodeMirror, y no se recompila nada.
 */
export default function PanelSplitter({
  panels,
  value,
  onCommit,
  controls,
}: {
  panels: RefObject<HTMLDivElement | null>;
  value: number;
  onCommit: (value: number) => void;
  controls: string;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const live = useRef(value);
  const dragging = useRef(false);
  const [active, setActive] = useState(false);
  if (!dragging.current) live.current = value;
  const preview = (next: number) => {
    live.current = next;
    const style = panels.current?.style;
    style?.setProperty("--editor-fr", `${next}fr`);
    style?.setProperty("--inspector-fr", `${100 - next}fr`);
    handle.current?.setAttribute("aria-valuenow", String(next));
    handle.current?.setAttribute("aria-valuetext", valueText(next));
  };
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    document.documentElement.classList.remove("is-resizing-panels");
    onCommit(live.current);
  };
  return (
    <div
      ref={handle}
      className="panel-splitter"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Ancho del editor y del inspector"
      aria-controls={controls}
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={SPLIT_MAX}
      aria-valuenow={value}
      aria-valuetext={valueText(value)}
      aria-describedby="panel-splitter-help"
      title="Arrastra para ajustar · doble clic para restablecer"
      data-dragging={active || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0 || !panels.current) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        dragging.current = true;
        setActive(true);
        document.documentElement.classList.add("is-resizing-panels");
      }}
      onPointerMove={(event) => {
        if (!dragging.current || !panels.current) return;
        const rect = panels.current.getBoundingClientRect();
        preview(
          splitFromPointer(
            event.clientX,
            rect.left,
            rect.width,
            event.currentTarget.offsetWidth,
          ),
        );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={() => onCommit(SPLIT_DEFAULT)}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = splitForKey(value, event.key, event.shiftKey);
        if (next === null) return;
        event.preventDefault();
        onCommit(next);
      }}
    >
      <span className="panel-splitter-grip" aria-hidden="true" />
      <span id="panel-splitter-help" className="sr">
        Flechas para ajustar, con Mayús en pasos de 10. Inicio y Fin llevan a
        los límites. Intro o doble clic restablecen el 50 %.
      </span>
    </div>
  );
}
