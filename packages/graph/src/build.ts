import type { Graph, GraphNode, GraphEdge, GraphInput } from "./types.js";
import { componentKey, contextKey } from "./types.js";

/**
 * Builds the unified component graph from plain trace data. One graph carries
 * every relationship; UI projections are just filters over its edge kinds:
 *   - `parent`        ownership hierarchy
 *   - `renders`       causality (which component's render caused another's)
 *   - `reads-context` dependency (component consumes a context)
 */
export function buildGraph(input: GraphInput): Graph {
  const nodes = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  const addEdge = (from: string, to: string, kind: GraphEdge["kind"], confidence: number) => {
    const key = `${from}->${to}:${kind}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ from, to, kind, confidence });
  };

  for (const c of input.components) {
    nodes.set(componentKey(c.id), {
      id: componentKey(c.id),
      kind: "component",
      label: c.name,
      ref: c.id,
    });
  }
  // Ownership edges only between known components.
  for (const c of input.components) {
    if (c.parentId !== undefined && nodes.has(componentKey(c.parentId))) {
      addEdge(componentKey(c.id), componentKey(c.parentId), "parent", 1);
    }
  }

  for (const render of input.renders ?? []) {
    const target = componentKey(render.componentId);
    if (!nodes.has(target)) continue;
    for (const reason of render.reasons) {
      if (reason.type === "parent" && "componentId" in reason) {
        const src = componentKey(reason.componentId);
        if (nodes.has(src)) addEdge(src, target, "renders", 1);
      } else if (reason.type === "context" && "contextType" in reason) {
        const ctx = contextKey(reason.contextType);
        if (!nodes.has(ctx)) {
          nodes.set(ctx, {
            id: ctx,
            kind: "context",
            label: reason.label ?? `Context ${reason.contextType}`,
            ref: reason.contextType,
          });
        }
        addEdge(ctx, target, "reads-context", 0.9);
      }
    }
  }

  return { nodes, edges };
}
