import type { CascadeEdge, CascadeNode, CascadeProjection } from "./model.js";

export interface CascadeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CascadeLayoutNode {
  node: CascadeNode;
  rect: CascadeRect;
}

export interface CascadeLayoutEdge {
  edge: CascadeEdge;
  from: CascadeRect;
  to: CascadeRect;
  /** Exit port on the source clip (right edge). */
  y1: number;
  /** Entry port on the target clip (left edge). */
  y2: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  /**
   * When set, the edge is an orthogonal family-bus: stub out to this x, run
   * vertically, stub in. Used for 1→many (and many→1) so cubics do not braid.
   */
  busX: number | null;
}

export interface CascadeLayout {
  nodes: CascadeLayoutNode[];
  edges: CascadeLayoutEdge[];
  worldWidth: number;
  worldHeight: number;
  nodeById: Map<string, CascadeLayoutNode>;
}

export interface CascadeLayoutOptions {
  columnGap?: number;
  rowGap?: number;
  paddingX?: number;
  paddingY?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  timeJitterMax?: number;
}

const DEFAULTS: Required<CascadeLayoutOptions> = {
  columnGap: 230,
  rowGap: 48,
  paddingX: 48,
  paddingY: 52,
  nodeWidth: 168,
  nodeHeight: 34,
  timeJitterMax: 52,
};

function parentSortKey(node: CascadeNode, parentOrder: ReadonlyMap<string, number>): number {
  if (node.parentId === null) return Number.MAX_SAFE_INTEGER;
  return parentOrder.get(node.parentId) ?? Number.MAX_SAFE_INTEGER;
}

function portYs(rect: CascadeRect, count: number): number[] {
  if (count <= 1) return [rect.y + rect.height / 2];
  const pad = Math.min(7, rect.height / 4);
  const usable = Math.max(6, rect.height - pad * 2);
  const ys: number[] = [];
  for (let i = 0; i < count; i++) ys.push(rect.y + pad + ((i + 0.5) / count) * usable);
  return ys;
}

/**
 * Deterministic DAG layout. Causal depth owns the horizontal axis; timestamp is
 * only a small offset inside a depth column so the graph stays causal first,
 * temporal second.
 */
export function layoutCascade(
  projection: CascadeProjection,
  options: CascadeLayoutOptions = {},
): CascadeLayout {
  const o = { ...DEFAULTS, ...options };
  const byDepth = new Map<number, CascadeNode[]>();
  for (const node of projection.nodes) {
    const list = byDepth.get(node.depth);
    if (list) list.push(node);
    else byDepth.set(node.depth, [node]);
  }

  const nodeById = new Map<string, CascadeLayoutNode>();
  const orderById = new Map<string, number>();
  let maxBottom = o.paddingY;
  let maxRight = o.paddingX;
  const interactionSpan = Math.max(
    0.001,
    projection.interaction.end - projection.interaction.start,
  );

  for (let depth = 0; depth <= projection.maxDepth; depth++) {
    const nodes = byDepth.get(depth) ?? [];
    nodes.sort((a, b) => {
      const pa = parentSortKey(a, orderById);
      const pb = parentSortKey(b, orderById);
      return (
        pa - pb ||
        a.timestamp - b.timestamp ||
        b.selfDuration - a.selfDuration ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    });

    nodes.forEach((node, index) => {
      const temporal = Math.max(
        0,
        Math.min(
          o.timeJitterMax,
          ((node.timestamp - projection.interaction.start) / interactionSpan) * o.timeJitterMax,
        ),
      );
      const durationBonus = Math.min(34, Math.log2(1 + Math.max(0, node.duration)) * 6);
      const width = o.nodeWidth + durationBonus + (node.kind === "aggregate" ? 18 : 0);
      const rect: CascadeRect = {
        x: o.paddingX + depth * o.columnGap + temporal,
        y: o.paddingY + index * o.rowGap,
        width,
        height: o.nodeHeight,
      };
      const layoutNode = { node, rect };
      nodeById.set(node.id, layoutNode);
      orderById.set(node.id, index);
      maxBottom = Math.max(maxBottom, rect.y + rect.height);
      maxRight = Math.max(maxRight, rect.x + rect.width);
    });
  }

  const outgoing = new Map<string, CascadeEdge[]>();
  const incoming = new Map<string, CascadeEdge[]>();
  for (const edge of projection.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const outs = outgoing.get(edge.from);
    if (outs) outs.push(edge);
    else outgoing.set(edge.from, [edge]);
    const ins = incoming.get(edge.to);
    if (ins) ins.push(edge);
    else incoming.set(edge.to, [edge]);
  }

  const outY = new Map<string, number>();
  const inY = new Map<string, number>();
  for (const [id, list] of outgoing) {
    const rect = nodeById.get(id)!.rect;
    list.sort(
      (a, b) =>
        (nodeById.get(a.to)?.rect.y ?? 0) - (nodeById.get(b.to)?.rect.y ?? 0) || a.order - b.order,
    );
    const ys = portYs(rect, list.length);
    list.forEach((item, i) => outY.set(item.id, ys[i]!));
  }
  for (const [id, list] of incoming) {
    const rect = nodeById.get(id)!.rect;
    list.sort(
      (a, b) =>
        (nodeById.get(a.from)?.rect.y ?? 0) - (nodeById.get(b.from)?.rect.y ?? 0) ||
        a.order - b.order,
    );
    const ys = portYs(rect, list.length);
    list.forEach((item, i) => inY.set(item.id, ys[i]!));
  }

  const adjacentOut = new Map<string, CascadeEdge[]>();
  for (const [id, list] of outgoing) {
    const fromDepth = nodeById.get(id)!.node.depth;
    const adjacent = list.filter((item) => nodeById.get(item.to)?.node.depth === fromDepth + 1);
    if (adjacent.length >= 2) adjacentOut.set(id, adjacent);
  }
  const adjacentIn = new Map<string, CascadeEdge[]>();
  for (const [id, list] of incoming) {
    const toDepth = nodeById.get(id)!.node.depth;
    const adjacent = list.filter(
      (item) =>
        nodeById.get(item.from)?.node.depth === toDepth - 1 && !adjacentOut.has(item.from),
    );
    if (adjacent.length >= 2) adjacentIn.set(id, adjacent);
  }

  const parentsByDepth = new Map<number, string[]>();
  for (const id of adjacentOut.keys()) {
    const depth = nodeById.get(id)!.node.depth;
    const bucket = parentsByDepth.get(depth);
    if (bucket) bucket.push(id);
    else parentsByDepth.set(depth, [id]);
  }
  for (const ids of parentsByDepth.values()) {
    ids.sort((a, b) => nodeById.get(a)!.rect.y - nodeById.get(b)!.rect.y);
  }

  const outBusX = new Map<string, number>();
  for (const ids of parentsByDepth.values()) {
    ids.forEach((id, slot) => {
      const parent = nodeById.get(id)!;
      const children = adjacentOut.get(id)!;
      const childLeft = Math.min(...children.map((item) => nodeById.get(item.to)!.rect.x));
      const preferred = parent.rect.x + parent.rect.width + 20 + slot * 12;
      outBusX.set(
        id,
        Math.max(
          parent.rect.x + parent.rect.width + 14,
          Math.min(preferred, childLeft - 52),
        ),
      );
    });
  }

  const inBusX = new Map<string, number>();
  for (const [id, list] of adjacentIn) {
    const child = nodeById.get(id)!;
    const parentRight = Math.max(
      ...list.map((item) => {
        const rect = nodeById.get(item.from)!.rect;
        return rect.x + rect.width;
      }),
    );
    inBusX.set(id, Math.max(parentRight + 20, child.rect.x - 52));
  }

  const edges: CascadeLayoutEdge[] = [];
  for (const edge of projection.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = fromNode.rect;
    const to = toNode.rect;
    const x1 = from.x + from.width;
    const y1 = outY.get(edge.id) ?? from.y + from.height / 2;
    const x2 = to.x;
    const y2 = inY.get(edge.id) ?? to.y + to.height / 2;
    const gutter = (x1 + x2) / 2;
    const outBus = adjacentOut.get(edge.from)?.some((item) => item.id === edge.id)
      ? outBusX.get(edge.from)
      : undefined;
    const inBus = adjacentIn.get(edge.to)?.some((item) => item.id === edge.id)
      ? inBusX.get(edge.to)
      : undefined;
    const busX = outBus ?? inBus ?? null;
    const portY1 = outBus != null ? from.y + from.height / 2 : y1;
    const portY2 = inBus != null ? to.y + to.height / 2 : y2;
    edges.push({
      edge,
      from,
      to,
      y1: portY1,
      y2: portY2,
      c1x: gutter,
      c1y: portY1,
      c2x: gutter,
      c2y: portY2,
      busX,
    });
  }

  return {
    nodes: [...nodeById.values()],
    edges,
    worldWidth: maxRight + o.paddingX,
    worldHeight: maxBottom + o.paddingY,
    nodeById,
  };
}
