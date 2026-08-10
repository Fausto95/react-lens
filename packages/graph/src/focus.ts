import type { Graph, GraphEdge, GraphNode } from "./types.js";

export interface Neighbors {
  incoming: GraphEdge[];
  outgoing: GraphEdge[];
}

/** Direct in/out edges of a node. */
export function neighbors(graph: Graph, nodeId: string): Neighbors {
  const incoming: GraphEdge[] = [];
  const outgoing: GraphEdge[] = [];
  for (const e of graph.edges) {
    if (e.to === nodeId) incoming.push(e);
    if (e.from === nodeId) outgoing.push(e);
  }
  return { incoming, outgoing };
}

/**
 * Focus Lens: the subgraph within `depth` hops of `nodeId` (both directions).
 * Everything unrelated is dropped, so the caller can render only what matters.
 */
export function focus(graph: Graph, nodeId: string, depth = 1): Graph {
  if (!graph.nodes.has(nodeId)) return { nodes: new Map(), edges: [] };

  const keep = new Set<string>([nodeId]);
  let frontier = new Set<string>([nodeId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const e of graph.edges) {
      if (frontier.has(e.from) && !keep.has(e.to)) next.add(e.to);
      if (frontier.has(e.to) && !keep.has(e.from)) next.add(e.from);
    }
    for (const id of next) keep.add(id);
    frontier = next;
    if (next.size === 0) break;
  }

  const nodes = new Map<string, GraphNode>();
  for (const id of keep) {
    const node = graph.nodes.get(id);
    if (node) nodes.set(id, node);
  }
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { nodes, edges };
}
