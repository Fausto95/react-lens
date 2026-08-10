import type { ComponentId } from "@react-lens/protocol";

/** Flat input: what the trace store knows about each component instance. */
export interface ComponentDatum {
  id: ComponentId;
  name: string;
  parentId?: ComponentId;
  renders: number;
  selfTime: number;
  compiled: boolean;
  /**
   * Did the component's most recent render change observable DOM output?
   * true = changed, false = no observable change (suspicious), null/undefined =
   * unknown. Drives the Changed / Potential-Waste projections.
   */
  observableChange?: boolean | null;
}

export type SemanticNode = ComponentNode | GroupNode;

export interface ComponentNode {
  kind: "component";
  key: string; // stable: `c:${id}`
  id: ComponentId;
  datum: ComponentDatum;
  children: SemanticNode[];
}

/** Repeated sibling components of the same type, compressed (§36). */
export interface GroupNode {
  kind: "group";
  key: string; // `g:${parentKey}:${name}`
  name: string;
  count: number;
  renders: number;
  selfTime: number;
  /** Instances whose last render produced no observable change. */
  suspicious: number;
  instances: ComponentNode[];
}

export interface BuildOptions {
  /** Compress ≥ `groupThreshold` same-name siblings into a group. */
  group?: boolean;
  groupThreshold?: number;
  /**
   * Projection filter. A component is kept if it matches OR is an ancestor of a
   * match, so the tree stays connected and shows only relevant paths.
   */
  include?: (d: ComponentDatum) => boolean;
}

export interface VisibleRow {
  key: string;
  depth: number;
  node: SemanticNode;
  expandable: boolean;
  expanded: boolean;
}
