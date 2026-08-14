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
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
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
  const interactionSpan = Math.max(0.001, projection.interaction.end - projection.interaction.start);

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

  const edges: CascadeLayoutEdge[] = [];
  for (const edge of projection.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = fromNode.rect;
    const to = toNode.rect;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const bend = Math.max(30, (x2 - x1) * 0.45);
    edges.push({
      edge,
      from,
      to,
      c1x: x1 + bend,
      c1y: y1,
      c2x: x2 - bend,
      c2y: y2,
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
