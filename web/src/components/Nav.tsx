import { useEffect, useState } from "react";

export function Logo() {
  return (
    <svg viewBox="0 0 26 18" aria-hidden="true">
      <path d="M0 5h14V0l12 9-12 9v-5H0z" />
    </svg>
  );
}

export function Nav() {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") ?? "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("cauce-theme", theme);
    } catch {
      /* sin almacenamiento: el tema sigue funcionando en esta sesión */
    }
  }, [theme]);

  const dark = theme === "dark";
  return (
    <nav className="nav" aria-label="Principal">
      <a className="mark" href="#top" aria-label="Cauce, inicio">
        <Logo /> Cauce
      </a>
      <div className="nav-links">
        <a href="#optimizador">Optimizador</a>
        <a href="#fases">Fases</a>
        <a href="#conectores">Conectores</a>
      </div>
      <button
        className="theme"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
        aria-pressed={dark}
      >
        {dark ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
          </svg>
        )}
      </button>
      <a className="btn sm" href="#crear">
        Probar Cauce
      </a>
    </nav>
  );
}
