import { INSPECTORS } from "./model.ts";
import type { Inspector } from "./model.ts";

/**
 * Enlaces internos `/estudio?vista=…`: la URL lleva solo la vista elegida.
 * Nunca contiene documento, fuente, datos, trabajos ni bindings.
 * Los nombres son estables y en español; cambiarlos rompe enlaces publicados.
 */
export const VIEW_PARAM = "vista";
export const VIEW_SLUGS: Record<Inspector, string> = {
  check: "resultado",
  tokens: "tokens",
  tree: "arbol",
  ast: "ast",
  flow: "flow",
  ir: "ir",
  schemas: "esquemas",
  python: "python",
};
/** Sección Resultados de ejecución: no es un inspector ni cambia el documento. */
export const EXECUTION_SLUG = "ejecucion";
export type StudioView =
  | { kind: "inspector"; inspector: Inspector }
  | { kind: "execution" };
export type ParsedView = {
  /** null: no hay vista válida; se conserva la del documento. */
  view: StudioView | null;
  /** Parámetros descartados, tal como llegaron, para el aviso visible. */
  ignored: string[];
};

const BY_SLUG = new Map<string, StudioView>([
  ...INSPECTORS.map(
    ([inspector]) =>
      [VIEW_SLUGS[inspector], { kind: "inspector", inspector }] as [
        string,
        StudioView,
      ],
  ),
  [EXECUTION_SLUG, { kind: "execution" }],
]);

export const viewSlugs = () => [...BY_SLUG.keys()];

/** Etiqueta visible de una vista (la misma del botón del inspector). */
export function viewLabel(view: StudioView) {
  if (view.kind === "execution") return "Resultados de ejecución";
  return INSPECTORS.find(([f]) => f === view.inspector)![1];
}

const shown = (text: string) =>
  text.length > 40 ? `${text.slice(0, 40)}…` : text;

/** Acepta exactamente un `vista` conocido (minúsculas); el resto se ignora. */
export function parseView(search: string): ParsedView {
  const params = new URLSearchParams(search);
  const ignored: string[] = [];
  for (const key of new Set(params.keys()))
    if (key !== VIEW_PARAM) ignored.push(shown(key));
  const values = params.getAll(VIEW_PARAM);
  if (values.length > 1) {
    ignored.push(`${VIEW_PARAM} repetido`);
    return { view: null, ignored };
  }
  if (!values.length) return { view: null, ignored };
  const view = BY_SLUG.get(values[0]) ?? null;
  if (!view) ignored.push(`${VIEW_PARAM}=${shown(values[0]) || "(vacío)"}`);
  return { view, ignored };
}

export function viewSlug(view: StudioView) {
  return view.kind === "execution" ? EXECUTION_SLUG : VIEW_SLUGS[view.inspector];
}

export function serializeView(view: StudioView) {
  return `?${VIEW_PARAM}=${viewSlug(view)}`;
}

export function viewHref(view: StudioView) {
  return `/studio${serializeView(view)}`;
}

export const inspectorView = (inspector: Inspector): StudioView => ({
  kind: "inspector",
  inspector,
});
