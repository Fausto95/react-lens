import type { ComponentId, ComponentType } from "@react-lens/protocol";

export type NodeKind = "component" | "context";

export interface GraphNode {
  /** Stable string key, e.g. `c:12` or `ctx:3`. */
  id: string;
  kind: NodeKind;
  label: string;
  /** Underlying numeric id (component or context type). */
  ref: number;
}

export type EdgeKind = "parent" | "renders" | "reads-context";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** 0..1; inferred causal edges carry lower confidence than ownership. */
  confidence: number;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/** Input for building the graph — plain data, decoupled from the trace store. */
export interface GraphInput {
  components: Array<{ id: ComponentId; name: string; parentId?: ComponentId }>;
  renders?: Array<{ componentId: ComponentId; reasons: RenderReasonLite[] }>;
}

export type RenderReasonLite =
  | { type: "parent"; componentId: ComponentId }
  | { type: "context"; contextType: ComponentType; label?: string }
  | { type: string };

export function componentKey(id: ComponentId): string {
  return `c:${id}`;
}
export function contextKey(id: ComponentType): string {
  return `ctx:${id}`;
}
