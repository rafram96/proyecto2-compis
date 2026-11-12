import { useEffect, useRef, useState } from "react";
import { TECHNOLOGIES } from "./technologies";

function TechnologyList({ duplicate = false }: { duplicate?: boolean }) {
  const base = `${import.meta.env.BASE_URL}brand/stack/`;
  return (
    <ul className="technology-list" aria-hidden={duplicate || undefined}>
      {TECHNOLOGIES.map((technology) => (
        <li key={technology.name}>
          <div
            className={`technology-brand ${"wordmark" in technology ? "is-wordmark" : ""}`}
          >
            <span className="technology-symbol">
              <img
                src={base + technology.logo}
                alt=""
                width={48}
                height={48}
                loading="lazy"
                decoding="async"
                className={
                  "darkLogo" in technology ? "technology-logo-light" : undefined
                }
              />
              {"darkLogo" in technology && (
                <img
                  src={base + technology.darkLogo}
                  alt=""
                  width={134}
                  height={48}
                  loading="lazy"
                  decoding="async"
                  className="technology-logo-dark"
                />
              )}
            </span>
            <strong className={"wordmark" in technology ? "sr" : undefined}>
              {technology.name}
            </strong>
          </div>
          <span className="technology-role">{technology.role}</span>
        </li>
      ))}
    </ul>
  );
}

export default function TechnologyStack() {
  const section = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    if (section.current) observer.observe(section.current);
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <section
      className="built"
      id="tecnologias"
      ref={section}
      aria-labelledby="built-title"
    >
      <div className="built-heading">
        <div>
          <h2 id="built-title">Construido sobre</h2>
          <p>
            Del análisis del lenguaje a tu navegador. Cada pieza tiene una
            función.
          </p>
        </div>
        <div
          className="technology-controls"
          aria-label="Presentación del stack"
        >
          {!expanded && (
            <button
              type="button"
              className="tool-button technology-pause"
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                {paused ? (
                  <path d="M6 3.5 15 10l-9 6.5Z" />
                ) : (
                  <path d="M5 4h3v12H5zM12 4h3v12h-3z" />
                )}
              </svg>
              {paused ? "Reanudar movimiento" : "Pausar movimiento"}
            </button>
          )}
          <button
            type="button"
            className="tool-button technology-view"
            aria-expanded={expanded}
            aria-controls="technology-viewport"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Volver al carrusel" : "Ver todo el stack"}
          </button>
        </div>
      </div>
      <div
        className="technology-viewport"
        id="technology-viewport"
        data-expanded={expanded}
        data-running={visible && pageVisible && !paused && !expanded}
      >
        <div className="technology-track">
          <TechnologyList />
          <TechnologyList duplicate />
        </div>
      </div>
      <p className="technology-note">
        El análisis se realiza en tu navegador; la ejecución con datos utiliza
        el servicio Python.
      </p>
    </section>
  );
}
