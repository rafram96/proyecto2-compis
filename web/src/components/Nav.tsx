import { useRef } from "react";
import { toggleTheme, useTheme } from "../lib/theme";

/** La marca: el agua que corre (~) y la punta de la flecha de FLOW (>). Igual que public/favicon.svg. */
export function Mark({ className = "mark-icon" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--mark-bg)" />
      <path d="M4.8 17.2c2.4-3.7 4.9-3.7 7.3 0s4.9 3.7 7.3 0" fill="none" stroke="var(--brand-pale)" strokeWidth="3.6" strokeLinecap="round" />
      <path d="M20.4 9.4l6.6 7.4-6.6 7.2" fill="none" stroke="var(--brand-amber)" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ThemeToggle() {
  const theme = useTheme();
  const btn = useRef<HTMLButtonElement>(null);
  const dark = theme === "dark";
  return (
    <button
      ref={btn}
      type="button"
      className="theme"
      onClick={() => toggleTheme(btn.current)}
      aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-pressed={dark}
      data-dark={dark}
    >
      {/* Una sola figura: la luna se vuelve sol al moverse la máscara y aparecer los rayos. */}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <mask id="theme-cut">
          <rect width="24" height="24" fill="#fff" />
          <circle className="cut" cx="17" cy="7" r="6" fill="#000" />
        </mask>
        <circle className="core" cx="12" cy="12" r="7" fill="currentColor" mask="url(#theme-cut)" />
        <g className="rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4 6 18M18 6l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}

export function Nav() {
  return (
    <nav className="nav" aria-label="Principal">
      <a className="wordmark" href="#top" aria-label="Cauce, inicio">
        <Mark /> Cauce
      </a>
      <div className="nav-links">
        <a href="#errores">Errores</a>
        <a href="#optimizador">Optimizador</a>
        <a href="#lenguaje">Lenguaje</a>
        <a href="#preguntas">Preguntas</a>
      </div>
      <ThemeToggle />
      <a className="btn sm nav-cta" href="#estudio">
        Abrir el estudio
      </a>
    </nav>
  );
}
