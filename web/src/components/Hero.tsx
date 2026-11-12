import { useEffect, useRef } from "react";
import { finalIR, programs, pyBody } from "../data";
import { Code } from "./Code";

const ventas = programs["ventas.etl"];
const out = ventas.default;

/** El mismo programa en cuatro fases del compilador; todo es salida real de etl_dsl. */
const FRAMES = [
  { file: "ventas.etl", note: "lo que escribes", code: ventas.source.split("\n").slice(1).join("\n") },
  { file: "tokens", note: "Lark lo lee palabra por palabra", code: out.tokens.out.split("\n").slice(0, 16).join("\n") },
  { file: "plan (IR)", note: "2 * 5 ya es 10", code: finalIR(out.ir.out) },
  { file: "ventas.py", note: "Python con Polars", code: pyBody(out.python.out) },
];

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export function Hero() {
  const hero = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);

  // La tira avanza con el desplazamiento: se queda quieta en cada marco y pasa al siguiente con suavidad.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = hero.current!;
      const total = el.offsetHeight - innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 0;
      const raw = p * (FRAMES.length - 1);
      const i = Math.min(FRAMES.length - 2, Math.floor(raw));
      const frac = Math.min(1, Math.max(0, (raw - i - 0.25) / 0.5));
      const pos = raw >= FRAMES.length - 1 ? FRAMES.length - 1 : i + ease(frac);
      track.current!.style.setProperty("--pos", pos.toFixed(4));
      track.current!.dataset.active = String(Math.round(pos));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <header className="hero" id="top" ref={hero}>
      <div className="hero-stage">
        <h1 className="hero-h">
          <span className="half left">
            <span className="mask">
              <span>Pipelines</span>
            </span>
          </span>{" "}
          <span className="half right">
            <span className="mask">
              <span>que se leen.</span>
            </span>
          </span>
        </h1>

        <div className="channel" aria-hidden="true" />
        <div className="reel" role="group" aria-label="Un mismo programa en cuatro fases del compilador">
          <div className="reel-track" ref={track} data-active="0">
            {FRAMES.map((f, i) => (
              <figure className="frame" data-ui key={f.file} data-i={i}>
                <figcaption className="ui-title">
                  <span className="ui-dot on" />
                  <span className="ui-dot" />
                  <b>{f.file}</b>
                  <span className="ui-note">{f.note}</span>
                </figcaption>
                <Code code={f.code} />
              </figure>
            ))}
          </div>
        </div>

        <div className="hero-foot">
          <p>Un lenguaje para mover y limpiar datos que se escribe como una receta. Compila a Python con Polars.</p>
          <a className="btn" href="#estudio">
            Compile en el navegador
          </a>
        </div>
      </div>
    </header>
  );
}
