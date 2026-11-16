"use strict";

// Tema claro u oscuro. Sigue al sistema hasta que la persona elige uno con el botón; la elección
// se recuerda en este navegador. Se carga en <head> para aplicar el tema antes de pintar la página.
// Al cambiar se emite el evento "etl-themechange" para que Monaco y los gráficos actualicen sus colores.
(() => {
  const KEY = "etl-dsl.theme";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  function store(value) {
    try { localStorage.setItem(KEY, value); } catch { /* sin persistencia */ }
  }
  function apply(theme) {
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
  }
  function current() {
    return root.dataset.theme ?? (media.matches ? "dark" : "light");
  }
  function notify() {
    window.dispatchEvent(new CustomEvent("etl-themechange", { detail: current() }));
  }

  apply(stored());
  media.addEventListener("change", () => { if (!root.dataset.theme) notify(); });
  window.etlTheme = { current };

  function setupButton() {
    const button = document.getElementById("theme-toggle");
    if (!button) return;
    const label = () => {
      const next = current() === "dark" ? "claro" : "oscuro";
      button.setAttribute("aria-label", `Cambiar a tema ${next}`);
      button.title = `Tema ${next}`;
    };
    label();
    button.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      apply(next);
      store(next);
      label();
      notify();
    });
    window.addEventListener("etl-themechange", label);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupButton);
  else setupButton();
})();
