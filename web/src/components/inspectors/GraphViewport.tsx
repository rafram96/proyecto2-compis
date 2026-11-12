import { useEffect, useRef, useState, type ReactNode } from "react";

/** Scroll nativo: funciona con trackpad, táctil y teclado; el zoom no captura
 * la rueda del usuario ni el gesto de desplazamiento de la página. */
export default function GraphViewport({
  width,
  height,
  label,
  children,
}: {
  width: number;
  height: number;
  label: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [availableWidth, setAvailableWidth] = useState(600);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailableWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const changeZoom = (value: number) =>
    setZoom(Math.max(0.35, Math.min(1.5, value)));
  return (
    <div className="graph-view">
      <div className="graph-toolbar" aria-label={`Controles de ${label}`}>
        <span>Desplaza para explorar</span>
        <button
          className="tool-button"
          aria-label="Alejar grafo"
          disabled={zoom <= 0.35}
          onClick={() => changeZoom(zoom - 0.15)}
        >
          −
        </button>
        <output aria-label="Zoom del grafo">{Math.round(zoom * 100)} %</output>
        <button
          className="tool-button"
          aria-label="Acercar grafo"
          disabled={zoom >= 1.5}
          onClick={() => changeZoom(zoom + 0.15)}
        >
          +
        </button>
        <button
          className="tool-button"
          onClick={() => {
            changeZoom((availableWidth - 24) / width);
            viewport.current?.scrollTo(0, 0);
          }}
        >
          Ajustar
        </button>
        <button
          className="tool-button"
          onClick={() => {
            setZoom(1);
            viewport.current?.scrollTo(0, 0);
          }}
        >
          1:1
        </button>
      </div>
      <div
        className="graph-scroll"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label={`${label}, desplazable`}
      >
        <div
          className="graph-size"
          style={{
            width: Math.ceil(width * zoom),
            height: Math.ceil(height * zoom),
          }}
        >
          <div
            className="graph-content"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
