/**
 * Geometry for the three-column layout — Components · Timeline · Inspector.
 *
 * Pure, so the rules that used to live inside a pointer-move handler (which
 * pane may grow, how far, what a collapsed neighbour frees up) are provable
 * without dragging anything.
 */

export const TREE_MIN = 180;
export const TREE_MAX = 520;
export const INSP_MIN = 260;
export const INSP_MAX = 620;
/** The timeline must stay wide enough for its footer controls to be reachable. */
export const TIMELINE_MIN = 340;
/** A collapsed pane keeps a rail wide enough for its expand button. */
export const RAIL_W = 28;

export interface CollapsedPanes {
  tree: boolean;
  inspector: boolean;
}

export const NONE_COLLAPSED: CollapsedPanes = { tree: false, inspector: false };

/** The grid's `grid-template-columns`, with collapsed panes reduced to rails. */
export function columnTemplate(
  treeW: number,
  inspW: number,
  collapsed: CollapsedPanes = NONE_COLLAPSED,
): string {
  const left = collapsed.tree ? RAIL_W : treeW;
  const right = collapsed.inspector ? RAIL_W : inspW;
  return `${left}px minmax(0, 1fr) ${right}px`;
}

/**
 * Preferred pane widths squeezed into a dock that cannot hold the three
 * minima at once. The stored prefs stay put — this is display-only, so
 * widening the dock restores the user's sizes.
 */
export function fitColumns(
  total: number,
  treeW: number,
  inspW: number,
  collapsed: CollapsedPanes = NONE_COLLAPSED,
): { treeW: number; inspW: number } {
  if (!(total > 0)) return { treeW, inspW };
  const left = collapsed.tree ? RAIL_W : treeW;
  const right = collapsed.inspector ? RAIL_W : inspW;
  if (left + right + TIMELINE_MIN <= total) return { treeW, inspW };

  const mid = Math.min(TIMELINE_MIN, Math.max(0, Math.floor(total * 0.36)));
  const sides = Math.max(0, total - mid);

  if (collapsed.tree) {
    return { treeW, inspW: collapsed.inspector ? inspW : Math.max(0, sides - RAIL_W) };
  }
  if (collapsed.inspector) {
    return { treeW: Math.max(0, sides - RAIL_W), inspW };
  }

  const sum = treeW + inspW;
  if (sum <= 0) {
    const half = Math.floor(sides / 2);
    return { treeW: half, inspW: sides - half };
  }
  const nextTree = Math.max(0, Math.round((treeW / sum) * sides));
  return { treeW: nextTree, inspW: Math.max(0, sides - nextTree) };
}

/**
 * Where a resize drag lands: the pointer's width, clamped to the pane's range
 * and to whatever the timeline can spare.
 */
export function nextColumnWidth(
  which: "tree" | "inspector",
  wanted: number,
  layout: {
    /** Width of the whole grid. */
    total: number;
    treeW: number;
    inspW: number;
    collapsed?: CollapsedPanes;
  },
): number {
  const collapsed = layout.collapsed ?? NONE_COLLAPSED;
  // A collapsed neighbour occupies a rail, not its stored width — so the pane
  // being dragged is free to grow into the space that frees up.
  const other =
    which === "tree"
      ? collapsed.inspector
        ? RAIL_W
        : layout.inspW
      : collapsed.tree
        ? RAIL_W
        : layout.treeW;
  const [min, max] = which === "tree" ? [TREE_MIN, TREE_MAX] : [INSP_MIN, INSP_MAX];
  const ceiling = Math.max(min, Math.min(max, layout.total - other - TIMELINE_MIN));
  return Math.max(min, Math.min(ceiling, wanted));
}
