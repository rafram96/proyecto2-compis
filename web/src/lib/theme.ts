import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "cauce-theme";
const root = document.documentElement;
const listeners = new Set<() => void>();

export const getTheme = (): Theme => (root.getAttribute("data-theme") === "dark" ? "dark" : "light");

function apply(next: Theme) {
  root.setAttribute("data-theme", next);
  // La barra del navegador móvil sigue al tema elegido, no al del sistema.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = next === "dark" ? "#0a1628" : "#f3fafd";
  });
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* sin almacenamiento: el tema vale solo para esta visita */
  }
  listeners.forEach((l) => l());
}

/**
 * Cambia el tema con un revelado circular que nace del botón (View Transitions API).
 * Sin soporte o con «reducir movimiento», hace un fundido corto de colores o un cambio directo.
 */
export function toggleTheme(from?: HTMLElement | null) {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) {
    root.classList.add("theme-fade");
    apply(next);
    window.setTimeout(() => root.classList.remove("theme-fade"), reduce ? 0 : 320);
    return;
  }
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : innerWidth - 40;
  const y = r ? r.top + r.height / 2 : 40;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  root.classList.add("theme-vt");
  const t = document.startViewTransition(() => apply(next));
  t.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 640, easing: "cubic-bezier(0.65, 0, 0.35, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  t.finished.finally(() => root.classList.remove("theme-vt"));
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getTheme,
  );
}
