/**
 * Proporción editor/inspector del estudio en escritorio. Es una preferencia de
 * este navegador, separada del documento: no toca `cauce-workspace-v1`.
 */
export const LAYOUT_KEY = "cauce-studio-layout-v1";
export const SPLIT_MIN = 30;
export const SPLIT_MAX = 70;
export const SPLIT_DEFAULT = 50;
export const SPLIT_STEP = 2;
export const SPLIT_STEP_LARGE = 10;
type StoragePort = Pick<Storage, "getItem" | "setItem">;

/** Porcentaje entero del ancho para el editor, dentro de los límites. */
export function clampSplit(value: number) {
  if (!Number.isFinite(value)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(value)));
}

/** Posición del puntero → porcentaje, descontando el ancho del divisor. */
export function splitFromPointer(
  clientX: number,
  left: number,
  width: number,
  handle: number,
) {
  const usable = width - handle;
  if (!(usable > 0)) return SPLIT_DEFAULT;
  return clampSplit(((clientX - left - handle / 2) / usable) * 100);
}

/** Teclado del separador: flechas (Mayús = paso grande), Inicio/Fin, Intro restablece. */
export function splitForKey(value: number, key: string, shift: boolean) {
  const step = shift ? SPLIT_STEP_LARGE : SPLIT_STEP;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampSplit(value - step);
    case "ArrowRight":
    case "ArrowUp":
      return clampSplit(value + step);
    case "Home":
      return SPLIT_MIN;
    case "End":
      return SPLIT_MAX;
    case "Enter":
      return SPLIT_DEFAULT;
    default:
      return null;
  }
}

export function decodeLayout(raw: string | null) {
  if (raw === null) return SPLIT_DEFAULT;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 1
  )
    throw new Error("Versión de disposición incompatible.");
  const editor = (value as { editor?: unknown }).editor;
  if (
    typeof editor !== "number" ||
    !Number.isInteger(editor) ||
    editor < SPLIT_MIN ||
    editor > SPLIT_MAX
  )
    throw new Error("Proporción de paneles fuera de rango.");
  return editor;
}

/** Nunca lanza: un valor dañado o un almacenamiento bloqueado vuelven al 50 %. */
export function readLayout(storage: StoragePort | undefined) {
  try {
    return decodeLayout(storage ? storage.getItem(LAYOUT_KEY) : null);
  } catch {
    return SPLIT_DEFAULT;
  }
}

/** Devuelve false si no se pudo guardar; la proporción sigue en memoria. */
export function writeLayout(storage: StoragePort | undefined, editor: number) {
  try {
    if (!storage) return false;
    storage.setItem(
      LAYOUT_KEY,
      JSON.stringify({ version: 1, editor: clampSplit(editor) }),
    );
    return true;
  } catch {
    return false;
  }
}
