import type { SemanticNode, VisibleRow } from "./types.js";

/**
 * Flattens the tree into the visible rows to render, honoring the expanded set.
 * Only expanded branches contribute descendants — the caller renders exactly
 * this list, enabling virtualization over tens of thousands of logical nodes.
 */
export function flatten(roots: SemanticNode[], expanded: Set<string>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  walk(roots, 0);
  return rows;

  function walk(nodes: SemanticNode[], depth: number): void {
    for (const node of nodes) {
      if (node.kind === "component") {
        const expandable = node.children.length > 0;
        const isExpanded = expandable && expanded.has(node.key);
        rows.push({ key: node.key, depth, node, expandable, expanded: isExpanded });
        if (isExpanded) walk(node.children, depth + 1);
      } else {
        const isExpanded = expanded.has(node.key);
        rows.push({ key: node.key, depth, node, expandable: true, expanded: isExpanded });
        if (isExpanded) walk(node.instances, depth + 1);
      }
    }
  }
}
