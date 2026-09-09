import type { CascadeNode, CascadeProjection } from "./model.js";

/**
 * The projection as a walkable tree, with per-subtree totals.
 *
 * Every lens needs the same two things — who are a node's children, and what
 * does its subtree cost — so they are derived once, here. Pure: plain data in,
 * plain data out, no React and no DOM.
 */

export interface SubtreeStats {
  /** Renders in this subtree, inclusive, counting aggregate members. */
  renderCount: number;
  /** Self time of this subtree, inclusive, in ms. */
  selfTime: number;
}

export interface CascadeTree {
  childrenOf: ReadonlyMap<string | null, CascadeNode[]>;
  subtreeById: ReadonlyMap<string, SubtreeStats>;
  roots: readonly CascadeNode[];
  byId: ReadonlyMap<string, CascadeNode>;
}

const EMPTY_STATS: SubtreeStats = { renderCount: 0, selfTime: 0 };

/**
 * Children keyed by parent, in a stable order. A node whose `parentId` is not
 * in the projection is re-rooted rather than dropped — an orphan render is
 * still a render, and the aggregation / overflow passes upstream can leave one
 * behind.
 */
export function indexCascadeTree(projection: CascadeProjection): CascadeTree {
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, CascadeNode[]>();
  for (const node of projection.nodes) {
    const parent = node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
    const list = childrenOf.get(parent);
    if (list) list.push(node);
    else childrenOf.set(parent, [node]);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp || a.depth - b.depth || a.id.localeCompare(b.id));
  }

  // Pre-order push, reverse iterate: a node is always reached after its
  // children have been totalled.
  const subtreeById = new Map<string, SubtreeStats>();
  const order: CascadeNode[] = [];
  const stack = [...(childrenOf.get(null) ?? [])];
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.push(node);
    for (const child of childrenOf.get(node.id) ?? []) stack.push(child);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]!;
    let renderCount = node.aggregateCount;
    let selfTime = node.selfDuration;
    for (const child of childrenOf.get(node.id) ?? []) {
      const stats = subtreeById.get(child.id) ?? EMPTY_STATS;
      renderCount += stats.renderCount;
      selfTime += stats.selfTime;
    }
    subtreeById.set(node.id, { renderCount, selfTime });
  }

  return { childrenOf, subtreeById, roots: childrenOf.get(null) ?? [], byId };
}

export function statsFor(tree: CascadeTree, node: CascadeNode): SubtreeStats {
  return (
    tree.subtreeById.get(node.id) ?? {
      renderCount: node.aggregateCount,
      selfTime: node.selfDuration,
    }
  );
}

/** Deepest level below `node`, 0 when it is a leaf. */
export function subtreeDepth(tree: CascadeTree, node: CascadeNode): number {
  let max = 0;
  const stack: [CascadeNode, number][] = [[node, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop()!;
    if (depth > max) max = depth;
    for (const child of tree.childrenOf.get(current.id) ?? []) stack.push([child, depth + 1]);
  }
  return max;
}
