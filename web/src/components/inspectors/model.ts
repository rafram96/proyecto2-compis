import type { Artifact, Span } from "../../compiler/types.ts";

/** Adaptación de forma del contrato 4. No infiere semántica del DSL. */
export type RecordValue = { [key: string]: unknown };
export const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
export const objects = (value: unknown): RecordValue[] =>
  Array.isArray(value) ? value.filter(record) : [];
export const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
export const label = (value: unknown) =>
  typeof value === "string" ? value : "";
export function spanOf(value: unknown): Span | undefined {
  if (!record(value)) return;
  if (
    !["line", "column", "end_line", "end_column", "start", "end"].every((k) =>
      Number.isSafeInteger(value[k]),
    )
  )
    return;
  const s = value as Span;
  if (
    s.line < 1 ||
    s.column < 1 ||
    s.end_line < s.line ||
    s.end_column < 1 ||
    s.start < 0 ||
    s.end < s.start ||
    (s.end_line === s.line && s.end_column < s.column)
  )
    return;
  return s;
}
export function available<T>(artifact?: Artifact<T>): T | undefined {
  return artifact?.status === "available" ? artifact.data : undefined;
}
export function unavailable(artifact?: Artifact): string {
  return artifact?.status === "blocked"
    ? "Artefacto bloqueado por un error en esta fase o una anterior. Puedes inspeccionar las fases disponibles y corregir el código."
    : artifact?.status === "not_requested"
      ? "Este artefacto no se solicitó. Compila desde Studio para solicitar todas las fases."
      : "Pulsa Compile para obtener este artefacto.";
}
export function pipelines(ast: unknown): RecordValue[] {
  return record(ast) ? objects(ast.pipelines) : [];
}
export function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (record(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "span")
        .map(([k, v]) => [k, clean(v)]),
    );
  return value;
}
/** JSON del navegador no puede certificar enteros fuera de Number.MAX_SAFE_INTEGER.
 * Las presentaciones textuales producidas en Python sí conservan sus lexemas. */
export function hasUnsafeInteger(value: unknown): boolean {
  if (typeof value === "number")
    return Number.isInteger(value) && !Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.some(hasUnsafeInteger);
  return record(value) && Object.values(value).some(hasUnsafeInteger);
}
export function numericText(value: unknown): string {
  return hasUnsafeInteger(value)
    ? "entero sin precisión segura; consultar IR textual"
    : String(value);
}
export function title(node: RecordValue): string {
  return (
    [
      label(node.node),
      label(node.name) || label(node.alias),
      label(node.operator),
      label(node.kind),
    ]
      .filter(Boolean)
      .join(" · ") || "Propiedades"
  );
}
export type FlowNode = {
  name: string;
  kind: string;
  detail: string;
  span?: Span;
  inputs: string[];
  outputs: string[];
  x: number;
  y: number;
  height: number;
};
export type FlowEdge = {
  from: string;
  to: string;
  fromPort: string;
  toPort: string;
  span?: Span;
  label: string;
};
export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  width: number;
  height: number;
  unresolved: boolean;
};
export function flowGraph(ast: unknown, name: string): FlowGraph {
  const all = pipelines(ast),
    pipe = all.find((p) => p.name === name);
  if (!pipe)
    return { nodes: [], edges: [], width: 0, height: 0, unresolved: false };
  const declarations = objects(pipe.declarations);
  const edges: FlowEdge[] = [];
  for (const connection of objects(
    record(pipe.flow) ? pipe.flow.connections : [],
  )) {
    const ends = objects(connection.endpoints);
    for (let i = 1; i < ends.length; i++) {
      const a = ends[i - 1],
        b = ends[i];
      const from = label(a.name),
        to = label(b.name),
        fromPort = label(a.port),
        toPort = label(b.port);
      edges.push({
        from,
        to,
        fromPort,
        toPort,
        span: spanOf(connection.span),
        label: `${from}${fromPort ? `.${fromPort}` : ""} → ${to}${toPort ? `.${toPort}` : ""}`,
      });
    }
  }
  // Disposición por capas de FLOW, sin validar ni corregir conexiones. Las estructuras
  // inválidas conservan sus declaraciones y conexiones en la alternativa accesible.
  const ranks = new Map<string, number>();
  for (let i = 0; i < declarations.length; i++) {
    let progress = false;
    for (const d of declarations) {
      const name = label(d.name),
        incoming = edges.filter((e) => e.to === name);
      if (!ranks.has(name) && incoming.every((e) => ranks.has(e.from))) {
        ranks.set(
          name,
          incoming.length
            ? Math.max(...incoming.map((e) => ranks.get(e.from)!)) + 1
            : 0,
        );
        progress = true;
      }
    }
    if (!progress) break;
  }
  const unresolved = declarations.some((d) => !ranks.has(label(d.name)));
  let fallback = Math.max(-1, ...ranks.values()) + 1;
  for (const d of declarations)
    if (!ranks.has(label(d.name))) ranks.set(label(d.name), fallback++);
  const nodes = declarations.map((d) => {
    const operation = record(d.operation) ? d.operation : {};
    const target =
      d.node === "Use" ? all.find((p) => p.name === d.pipeline) : undefined;
    const targetDecls = target ? objects(target.declarations) : [];
    const kind = label(d.node).toUpperCase();
    const inputs =
      d.node === "Use"
        ? targetDecls
            .filter((n) => n.node === "Input")
            .map((n) => label(n.name))
        : operation.node === "Join"
          ? ["left", "right"]
          : [];
    const outputs =
      d.node === "Use"
        ? targetDecls
            .filter((n) => n.node === "Output")
            .map((n) => label(n.name))
        : [];
    const name = label(d.name);
    const detail =
      label(operation.node)
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toUpperCase() ||
      label(d.pipeline) ||
      (record(d.connector) ? label(d.connector.name) : "");
    const lines = (text: string, width: number) =>
      Math.max(1, Math.ceil(Array.from(text).length / width));
    return {
      name,
      kind,
      detail,
      span: spanOf(d.span),
      inputs,
      outputs,
      x: 0,
      y: 0,
      height:
        48 +
        lines(name, 18) * 24 +
        lines(`${kind} · ${detail}`, 22) * 16 +
        [...inputs, ...outputs].reduce(
          (height, port) => height + lines(`entrada .${port}`, 20) * 22,
          0,
        ),
    };
  });
  let y = 16,
    width = 216;
  for (const rank of [...new Set(ranks.values())].sort((a, b) => a - b)) {
    const layer = nodes.filter((n) => ranks.get(n.name) === rank);
    layer.forEach((n, i) => {
      n.x = 16 + i * 216;
      n.y = y;
    });
    y += Math.max(...layer.map((n) => n.height)) + 76;
    width = Math.max(width, layer.length * 216 + 16);
  }
  return { nodes, edges, width, height: Math.max(0, y - 60), unresolved };
}
export type IRRow = {
  before?: RecordValue;
  after?: RecordValue;
  status: "conservado" | "cambiado" | "eliminado" | "sin correspondencia";
};
/** Solo se llama con los módulos de UNA respuesta. origin es la procedencia que
 * permite relacionar declaraciones, incluso en fusiones; el nombre solo no basta. */
export function compareIR(
  before: RecordValue[],
  after: RecordValue[],
): IRRow[] {
  const matched = new Set<RecordValue>();
  const rows: IRRow[] = before.map((b) => {
    const origins = strings(b.origin);
    const candidates = origins.length
      ? after.filter((a) => origins.every((o) => strings(a.origin).includes(o)))
      : [];
    const a = candidates.length === 1 ? candidates[0] : undefined;
    if (a) matched.add(a);
    return {
      before: b,
      after: a,
      status: a
        ? hasUnsafeInteger(a) || hasUnsafeInteger(b)
          ? "sin correspondencia"
          : JSON.stringify(clean(a)) === JSON.stringify(clean(b))
            ? "conservado"
            : "cambiado"
        : origins.length &&
            after.every((a) => strings(a.origin).length > 0) &&
            !after.some((a) =>
              strings(a.origin).some((o) => origins.includes(o)),
            )
          ? "eliminado"
          : "sin correspondencia",
    };
  });
  for (const a of after)
    if (!matched.has(a)) rows.push({ after: a, status: "sin correspondencia" });
  return rows;
}
export function modulePipelines(module: unknown): RecordValue[] {
  return record(module) ? objects(module.pipelines) : [];
}
