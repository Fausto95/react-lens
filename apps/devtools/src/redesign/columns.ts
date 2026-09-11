/**
 * Geometry for the two-column layout — Cascade · Inspector.
 *
 * Pure, so the rules that used to live inside a pointer-move handler (which
 * pane may grow, how far, what a collapsed neighbour frees up) are provable
 * without dragging anything.
 */

export const INSP_MIN = 260;
export const INSP_MAX = 620;
/** The timeline must stay wide enough for its footer controls to be reachable. */
export const TIMELINE_MIN = 340;
/** A collapsed pane keeps a rail wide enough for its expand button. */
export const RAIL_W = 28;

export interface CollapsedPanes {
  inspector: boolean;
}

export const NONE_COLLAPSED: CollapsedPanes = { inspector: false };

/** The grid's `grid-template-columns`, with a collapsed pane reduced to a rail. */
export function columnTemplate(inspW: number, collapsed: CollapsedPanes = NONE_COLLAPSED): string {
  return `minmax(0, 1fr) ${collapsed.inspector ? RAIL_W : inspW}px`;
}

/**
 * The preferred inspector width squeezed into a dock that cannot hold it and
 * the cascade's minimum at once. The stored pref stays put — this is
 * display-only, so widening the dock restores the user's size.
 */
export function fitColumns(
  total: number,
  inspW: number,
  collapsed: CollapsedPanes = NONE_COLLAPSED,
): { inspW: number } {
  if (!(total > 0) || collapsed.inspector) return { inspW };
  if (inspW + TIMELINE_MIN <= total) return { inspW };
  return { inspW: Math.max(0, total - Math.min(TIMELINE_MIN, Math.floor(total * 0.55))) };
}

/**
 * Where a resize drag lands: the pointer's width, clamped to the pane's range
 * and to whatever the cascade can spare.
 */
export function nextColumnWidth(
  wanted: number,
  layout: {
    /** Width of the whole grid. */
    total: number;
    inspW: number;
    collapsed?: CollapsedPanes;
  },
): number {
  const ceiling = Math.max(INSP_MIN, Math.min(INSP_MAX, layout.total - TIMELINE_MIN));
  return Math.max(INSP_MIN, Math.min(ceiling, wanted));
}
