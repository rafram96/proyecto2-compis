import type { Span } from "../../compiler/types.ts";
import { label, record, spanOf, title } from "./model.ts";

export type TreeNode = {
  id: string;
  name: string;
  relation: string;
  kind: string;
  span?: Span;
  properties: [string, string][];
  children: TreeNode[];
};
export type TreeData = { root: TreeNode; limited: boolean };
const LIMIT = 4000;

/** Proyección estructural del AST real. Los escalares se leen en el detalle,
 * no se convierten en decenas de hojas sin significado. Nunca cambia el AST. */
export function astTree(value: unknown): TreeData {
  let count = 0;
  let limited = false;
  function visit(
    value: unknown,
    relation: string,
    id: string,
    depth: number,
  ): TreeNode {
    const node = record(value) ? value : {};
    const result: TreeNode = {
      id,
      name: title(node),
      relation,
      kind: label(node.node),
      span: spanOf(node.span),
      properties: [],
      children: [],
    };
    count++;
    for (const [key, child] of Object.entries(node)) {
      if (key === "span" || key === "node") continue;
      if (record(child) || (Array.isArray(child) && child.some(record))) {
        const children = Array.isArray(child) ? child : [child];
        children.forEach((item, i) => {
          if (!record(item)) return;
          if (count >= LIMIT || depth >= 70) {
            limited = true;
            return;
          }
          result.children.push(
            visit(
              item,
              Array.isArray(child) ? `${key} · ${i + 1}` : key,
              `${id}/${key}/${i}`,
              depth + 1,
            ),
          );
        });
      } else {
        result.properties.push([key, JSON.stringify(child)]);
      }
    }
    return result;
  }
  return { root: visit(value, "AST", "ast", 0), limited };
}

/** Adapta exclusivamente la jerarquía que publica Lark pretty(), sin volver a
 * parsear el DSL ni asignar posiciones que el artefacto no proporciona. */
export function parseTree(text: string): TreeData | null {
  const roots: TreeNode[] = [];
  const stack: { indent: number; node: TreeNode }[] = [];
  let count = 0;
  let limited = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (count >= LIMIT) {
      limited = true;
      break;
    }
    const indent = line.length - line.trimStart().length;
    const content = line.trim();
    const [name, ...inline] = content.split("\t");
    const node: TreeNode = {
      id: `parse-${count++}`,
      name,
      relation: "Regla gramatical",
      kind: "rule",
      properties: [],
      children: [],
    };
    while (stack.length && stack[stack.length - 1].indent >= indent)
      stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    // Lark agrupa una regla de hijo único y su terminal en una misma línea.
    if (inline.length)
      node.children.push({
        id: `${node.id}/token`,
        name: inline.join("\t"),
        relation: "Terminal",
        kind: "token",
        properties: [],
        children: [],
      });
    stack.push({ indent, node });
  }
  if (!roots.length) return null;
  return {
    root:
      roots.length === 1
        ? roots[0]
        : {
            id: "parse-root",
            name: "Parse tree",
            relation: "Lark",
            kind: "rule",
            properties: [],
            children: roots,
          },
    limited,
  };
}

export function treeNodes(root: TreeNode): TreeNode[] {
  const all: TreeNode[] = [],
    pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    all.push(node);
    pending.push(...node.children);
  }
  return all;
}

export function nodeDescription(kind: string) {
  const descriptions: Record<string, string> = {
    Program: "Contiene los pipelines del programa.",
    Pipeline:
      "Agrupa fuentes, transformaciones, destinos y sus conexiones FLOW.",
    Source: "Lee datos con un conector como CSV o Parquet.",
    Input: "Declara una entrada reutilizable y su contrato de columnas.",
    Step: "Declara una transformación. FLOW determina de dónde recibe datos.",
    Sink: "Escribe el resultado con el conector indicado.",
    Output: "Expone la salida del pipeline.",
    Use: "Reutiliza otro pipeline mediante sus puertos.",
    Flow: "Define las conexiones entre declaraciones.",
    Connection: "Conecta dos o más extremos en el orden escrito.",
    Filter: "Conserva las filas que cumplen una condición.",
    Select: "Elige las columnas que continúan al siguiente paso.",
    Aggregate: "Agrupa filas y calcula valores como suma o cantidad.",
    BinaryExpr: "Combina dos expresiones mediante un operador.",
    Literal: "Representa un valor escrito en el programa.",
    rule: "Regla de la gramática reconocida por Lark. Expande sus hijos para ver cómo se construye.",
    token:
      "Terminal del árbol de análisis. La vista Tokens ofrece su ubicación exacta.",
  };
  return (
    descriptions[kind] ??
    "Nodo del AST original. Sus propiedades y su ubicación proceden del compilador."
  );
}
