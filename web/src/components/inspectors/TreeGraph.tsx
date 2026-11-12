import { useMemo, useState } from "react";
import { hierarchy, tree } from "d3-hierarchy";
import type { SourceProps } from "./SourceButton";
import { SourceButton } from "./SourceButton";
import GraphViewport from "./GraphViewport";
import { nodeDescription, treeNodes, type TreeData } from "./tree";

export default function TreeGraph({
  data,
  source,
  label,
}: {
  data: TreeData;
  source: SourceProps;
  label: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([data.root.id]),
  );
  const [selected, setSelected] = useState(data.root.id);
  const [hovered, setHovered] = useState<string | null>(null);
  const all = useMemo(() => treeNodes(data.root), [data]);
  const layout = useMemo(() => {
    let remaining = 349;
    const visible = { ...data.root, children: [] as (typeof data.root)[] };
    const pending = [{ original: data.root, copy: visible }];
    let limited = false;
    while (pending.length) {
      const { original, copy } = pending.shift()!;
      if (!expanded.has(original.id)) continue;
      for (const child of original.children) {
        if (remaining-- <= 0) {
          limited = true;
          break;
        }
        const next = { ...child, children: [] as (typeof data.root)[] };
        copy.children.push(next);
        pending.push({ original: child, copy: next });
      }
    }
    const root = hierarchy(visible);
    const positioned = tree<typeof data.root>()
      .nodeSize([100, 248])
      .separation(() => 1)(root);
    const nodes = positioned.descendants();
    const minX = Math.min(...nodes.map((n) => n.x));
    return {
      nodes,
      links: positioned.links(),
      minX,
      limited,
      width: Math.max(...nodes.map((n) => n.y)) + 238,
      height: Math.max(...nodes.map((n) => n.x)) - minX + 110,
    };
  }, [data, expanded]);
  const active = all.find((n) => n.id === (hovered ?? selected)) ?? data.root;
  function toggle(id: string) {
    setExpanded((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  return (
    <>
      <div className="inspector-controls tree-controls">
        <span>
          {layout.nodes.length} de {all.length}
          {data.limited ? "+" : ""} nodos
        </span>
        <button
          className="tool-button"
          onClick={() =>
            setExpanded(new Set(all.slice(0, 250).map((n) => n.id)))
          }
        >
          Expandir niveles
        </button>
        <button
          className="tool-button"
          onClick={() => setExpanded(new Set([data.root.id]))}
        >
          Restablecer árbol
        </button>
      </div>
      {(data.limited || layout.limited) && (
        <p className="stale-note">
          Vista gráfica limitada para mantener la navegación fluida. Explora una
          rama o consulta el texto completo.
        </p>
      )}
      <GraphViewport width={layout.width} height={layout.height} label={label}>
        <svg
          width={layout.width}
          height={layout.height}
          className="tree-edges"
          aria-hidden="true"
        >
          {layout.links.map(({ source: a, target: b }) => {
            const ax = a.y + 218,
              ay = a.x - layout.minX + 50,
              bx = b.y + 16,
              by = b.x - layout.minX + 50;
            return (
              <path
                key={b.data.id}
                d={`M${ax},${ay} C${ax + 24},${ay} ${bx - 24},${by} ${bx},${by}`}
                data-active={b.data.id === active.id}
              />
            );
          })}
        </svg>
        {layout.nodes.map(({ data: node, x, y }) => (
          <div
            className="tree-node"
            key={node.id}
            data-active={node.id === active.id}
            data-kind={node.kind}
            style={{ left: y + 16, top: x - layout.minX + 12 }}
            onMouseEnter={() => {
              setHovered(node.id);
              if (source.current) source.onPreview?.(node.span);
            }}
            onMouseLeave={() => {
              setHovered(null);
              source.onPreview?.();
            }}
          >
            <button
              className="tree-node-label"
              aria-label={`Inspeccionar ${node.name}`}
              aria-pressed={selected === node.id}
              onFocus={() => {
                setHovered(node.id);
                if (source.current) source.onPreview?.(node.span);
              }}
              onBlur={() => {
                setHovered(null);
                source.onPreview?.();
              }}
              onClick={() => {
                setSelected(node.id);
                if (source.current && node.span) source.onSelect(node.span);
              }}
            >
              <span>{node.relation}</span>
              <strong title={node.name}>{node.name}</strong>
            </button>
            {!!all.find((n) => n.id === node.id)?.children.length && (
              <button
                className="tree-toggle"
                aria-label={`${expanded.has(node.id) ? "Contraer" : "Expandir"} ${node.name}`}
                aria-expanded={expanded.has(node.id)}
                onClick={() => toggle(node.id)}
              >
                {expanded.has(node.id) ? "−" : "+"}
              </button>
            )}
          </div>
        ))}
      </GraphViewport>
      <section className="node-detail" aria-label="Detalle del nodo">
        <div>
          <strong>{active.name}</strong>
          <span>
            {active.relation}
            {active.span
              ? ` · L${active.span.line}:${active.span.column}–${active.span.end_line}:${active.span.end_column}`
              : ""}
          </span>
        </div>
        <p>{nodeDescription(active.kind)}</p>
        {active.properties.length > 0 && (
          <dl>
            {active.properties.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {active.span && (
          <SourceButton {...source} span={active.span}>
            Seleccionar {active.name}
          </SourceButton>
        )}
      </section>
    </>
  );
}
