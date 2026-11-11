/** Selección y lectura de la campaña C5 publicada. No recalcula ni redondea los datos fuente. */
export type Phase = "execute" | "compile";
export type Cell = {
  phase: Phase;
  workload: string;
  size: number;
  scenario: string;
  configuration: string;
  passes: string[];
  n: number;
  median: number;
  p25: number;
  p75: number;
  iqr: number;
  min: number;
  max: number;
  ratio: number;
  samples: number[];
};
export type Structure = {
  workload: string;
  configuration: string;
  passes: string[];
  nodes_before: number;
  nodes_after: number;
  changed: boolean;
  removed: string[];
  added: string[];
  modified: string[];
  operators_before: Record<string, number>;
  operators_after: Record<string, number>;
  range_rewrites: {
    node: string;
    action: string;
    before: string;
    after: string | null;
    reason: string;
    consumers: string[];
    facts: {
      column: string;
      lower: { value: number; inclusive: boolean } | null;
      upper: { value: number; inclusive: boolean } | null;
      nullable: boolean;
    }[];
  }[];
  join_rewrites: {
    node: string;
    action: string;
    guarantee: string;
    retained: string;
    eliminated: string;
    consumers: string[];
    static_proof: string[];
    obligations: string[];
    verification: string;
  }[];
};
export type Selection = {
  phase: Phase;
  workload: string;
  size: number;
  scenario: string;
  configurations: string[];
};
export type Catalog = {
  workloads: { id: string }[];
  sizes: number[];
  scenarios: string[];
  configurations: string[];
};

export const MANUAL = "manual";
export const REFERENCE = "O0";
const PHASES: Record<string, Phase> = { ejecucion: "execute", compilacion: "compile" };
const PHASE_PARAM: Record<Phase, string> = { execute: "ejecucion", compile: "compilacion" };

/** Configuraciones en el orden del arnés, con el baseline manual al final. */
export function catalog(data: {
  workloads: { id: string }[];
  campaign: { sizes: number[]; scenarios: string[]; configuration_order: string[] };
}): Catalog {
  return {
    workloads: data.workloads,
    sizes: data.campaign.sizes,
    scenarios: data.campaign.scenarios,
    configurations: data.campaign.configuration_order,
  };
}

export function defaultSelection(c: Catalog): Selection {
  return {
    phase: "execute",
    workload: c.workloads[0].id,
    size: Math.max(...c.sizes),
    scenario: c.scenarios[0],
    configurations: [...c.configurations],
  };
}

/** Configuraciones aplicables: manual no tiene compilación DSL y O0 siempre es la referencia visible. */
export function applicable(c: Catalog, phase: Phase) {
  return c.configurations.filter((name) => phase === "execute" || name !== MANUAL);
}

/** Lee la URL; un valor desconocido se ignora y se informa, nunca se aproxima a otro. */
export function parseSelection(search: string, c: Catalog) {
  const params = new URLSearchParams(search);
  const selection = defaultSelection(c);
  const ignored: string[] = [];
  const known = new Set(["fase", "workload", "filas", "escenario", "config"]);
  for (const key of new Set(params.keys())) if (!known.has(key)) ignored.push(key);
  const phase = params.get("fase");
  if (phase !== null) {
    if (phase in PHASES) selection.phase = PHASES[phase];
    else ignored.push("fase");
  }
  const workload = params.get("workload");
  if (workload !== null) {
    if (c.workloads.some((w) => w.id === workload)) selection.workload = workload;
    else ignored.push("workload");
  }
  if (selection.phase === "execute") {
    const size = params.get("filas");
    if (size !== null) {
      if (/^\d+$/.test(size) && c.sizes.includes(Number(size))) selection.size = Number(size);
      else ignored.push("filas");
    }
    const scenario = params.get("escenario");
    if (scenario !== null) {
      if (c.scenarios.includes(scenario)) selection.scenario = scenario;
      else ignored.push("escenario");
    }
  }
  const config = params.get("config");
  const allowed = applicable(c, selection.phase);
  if (config !== null) {
    const names = config.split(",");
    const valid = names.filter((name) => allowed.includes(name));
    if (valid.length !== names.length || !valid.length) ignored.push("config");
    if (valid.length) selection.configurations = allowed.filter((name) => name === REFERENCE || valid.includes(name));
  }
  selection.configurations = normalize(selection.configurations, c, selection.phase);
  return { selection, ignored };
}

export function normalize(names: string[], c: Catalog, phase: Phase) {
  const allowed = applicable(c, phase);
  return allowed.filter((name) => name === REFERENCE || names.includes(name));
}

/** Solo serializa lo que define la celda: la compilación no tiene filas ni escenario. */
export function serializeSelection(selection: Selection, c: Catalog) {
  const params = new URLSearchParams({ fase: PHASE_PARAM[selection.phase], workload: selection.workload });
  if (selection.phase === "execute") {
    params.set("filas", String(selection.size));
    params.set("escenario", selection.scenario);
  }
  const all = applicable(c, selection.phase);
  if (selection.configurations.length !== all.length) params.set("config", selection.configurations.join(","));
  return "?" + params.toString();
}

/** Filas de una única celda comparable: misma fase, workload, tamaño y escenario. */
export function rowsFor(cells: Cell[], selection: Selection, c: Catalog) {
  const size = selection.phase === "compile" ? 0 : selection.size;
  const scenario = selection.phase === "compile" ? "not_applicable" : selection.scenario;
  const matching = cells.filter(
    (cell) =>
      cell.phase === selection.phase &&
      cell.workload === selection.workload &&
      cell.size === size &&
      cell.scenario === scenario,
  );
  const order = applicable(c, selection.phase);
  const rows = selection.configurations
    .map((name) => matching.find((cell) => cell.configuration === name))
    .filter((cell): cell is Cell => Boolean(cell))
    .sort((a, b) => order.indexOf(a.configuration) - order.indexOf(b.configuration));
  const reference = matching.find((cell) => cell.configuration === REFERENCE);
  if (!reference || rows.length !== selection.configurations.length)
    throw new Error("Celda incompleta en la evidencia publicada");
  return { rows, reference };
}

export type Reading = { key: string; text: string };
/**
 * Ayuda de lectura descriptiva, no una prueba estadística: compara la diferencia de medianas con el
 * mayor IQR de ambas filas y, en ejecución, consulta si el pase cambió realmente la IR.
 */
export function reading(cell: Cell, reference: Cell, transforms: boolean | null): Reading {
  if (cell.configuration === REFERENCE) return { key: "reference", text: "Referencia O0" };
  const delta = Math.abs(cell.median - reference.median);
  const within = delta <= Math.max(cell.iqr, reference.iqr);
  if (cell.phase === "execute" && transforms === false)
    return { key: "no-rewrite", text: "Sin reescritura: la variación no se atribuye al pase" };
  if (within) return { key: "within", text: "Diferencia menor que el IQR: no concluyente" };
  return cell.ratio > 1
    ? { key: "faster", text: "Menos tiempo observado" }
    : { key: "slower", text: "Más tiempo observado" };
}

export function transforms(structure: Structure[], workload: string, configuration: string) {
  if (configuration === MANUAL) return null;
  const entry = structure.find((s) => s.workload === workload && s.configuration === configuration);
  return entry ? entry.changed : null;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const rowsLabel = (n: number) => group(String(n));
export const ms = (value: number) => value.toFixed(4);
export const ratio = (value: number) => value.toFixed(3);

/** Marcas lineales desde cero; el eje nunca se trunca para exagerar diferencias. */
export function ticks(max: number) {
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const top = Math.ceil(max / step) * step;
  return { top, values: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Number((i * step).toPrecision(12))) };
}

export const OBLIGATIONS: Record<string, string> = {
  equal_physical_key_types: "Tipos físicos iguales en ambas claves",
  nonnull_keys: "Claves sin NULL",
  unique_right_key: "Clave derecha única",
  total_left_reference: "Toda fila izquierda encuentra su referencia",
  materialized_input_snapshots: "Instantáneas materializadas de ambas entradas",
};
export const STATIC_PROOF: Record<string, string> = {
  complete_input_columns: "Columnas de entrada conocidas por completo",
  all_consumers_select_only_left_columns: "Todos los consumidores seleccionan solo columnas izquierdas",
};
