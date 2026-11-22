import type { SchemaGraph, SchemaTableNode } from '../types/schema.ts';

export const ERD_CARD_WIDTH = 332;
const COL_GAP = 148;
const ROW_GAP = 56;
const START_X = 80;
const START_Y = 80;

export function estimateCardHeight(node: SchemaTableNode): number {
  const rowCount = Math.max(1, node.columns.length);
  return 124 + rowCount * 33;
}

/**
 * Relationship-aware non-overlapping layered layout.
 * Places referenced parent tables on the left and child/dependent tables & views
 * in subsequent columns to the right, stacking vertically with exact height math.
 */
export function computeAutoLayout(graph: SchemaGraph): SchemaGraph {
  if (graph.nodes.length === 0) return graph;

  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>();

  for (const n of graph.nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, new Set());
  }

  // Edge direction for layout: parent (target of FK) -> child (source of FK)
  for (const rel of graph.relations) {
    if (rel.sourceId === rel.targetId) continue;
    if (!nodeMap.has(rel.sourceId) || !nodeMap.has(rel.targetId)) continue;
    if (!adj.get(rel.targetId)!.has(rel.sourceId)) {
      adj.get(rel.targetId)!.add(rel.sourceId);
      inDegree.set(rel.sourceId, (inDegree.get(rel.sourceId) || 0) + 1);
    }
  }

  // Assign topological column layers (BFS with cycle guard)
  const layerMap = new Map<string, number>();
  const queue: string[] = [];

  for (const n of graph.nodes) {
    if ((inDegree.get(n.id) || 0) === 0) {
      layerMap.set(n.id, 0);
      queue.push(n.id);
    }
  }

  let head = 0;
  const maxLayer = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(graph.nodes.length))));
  while (head < queue.length) {
    const curr = queue[head++];
    const currLayer = layerMap.get(curr) || 0;
    for (const next of adj.get(curr) || []) {
      const candidate = Math.min(maxLayer, currLayer + 1);
      if ((layerMap.get(next) ?? -1) < candidate) {
        layerMap.set(next, candidate);
        queue.push(next);
      }
    }
  }

  // Any remaining cycle nodes
  for (const n of graph.nodes) {
    if (!layerMap.has(n.id)) {
      layerMap.set(n.id, 0);
    }
  }

  // Bucket into columns; cap items per column so layout stays balanced horizontally
  const totalNodes = graph.nodes.length;
  const maxPerCol = Math.max(3, Math.ceil(Math.sqrt(totalNodes)));
  const columns: SchemaTableNode[][] = [];

  const sortedByLayer = [...graph.nodes].sort((a, b) => {
    const la = layerMap.get(a.id) ?? 0;
    const lb = layerMap.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
    if (a.kind !== b.kind) return a.kind === 'table' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const node of sortedByLayer) {
    let colIdx = layerMap.get(node.id) ?? 0;
    while (columns[colIdx] && columns[colIdx].length >= maxPerCol) {
      colIdx++;
    }
    if (!columns[colIdx]) columns[colIdx] = [];
    columns[colIdx].push(node);
  }

  // Compact empty columns
  const compactedCols = columns.filter((col) => col && col.length > 0);
  const positionById = new Map<string, { x: number; y: number }>();

  compactedCols.forEach((colNodes, colIdx) => {
    let currY = START_Y;
    const x = START_X + colIdx * (ERD_CARD_WIDTH + COL_GAP);
    for (const node of colNodes) {
      positionById.set(node.id, { x, y: currY });
      currY += estimateCardHeight(node) + ROW_GAP;
    }
  });

  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({
      ...n,
      visibleOnCanvas: true,
      position: positionById.get(n.id) ?? n.position,
    })),
  };
}
