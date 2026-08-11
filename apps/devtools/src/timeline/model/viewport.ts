import {
  SCALE_MAX,
  SCALE_MIN,
  buildScale,
  clamp,
  projectT,
  scaleForProjectedWidth,
  type TimeScale,
  type TimeSpan,
} from "./scale.js";

/**
 * The timeline viewport — the single source of truth for "what you are
 * looking at".
 *
 * It is deliberately just `{ zoom, scrollLeft, width }`. The visible time
 * window is **always derived** from those three via `windowOf`, and never
 * stored. Keeping a window alongside a scroll offset means two values can
 * describe the same thing and drift apart; every zoom/pan/scroll defect in the
 * previous implementation came from reconciling that pair inside effects.
 */
export interface Viewport {
  /**
   * px per active millisecond, or `"fit"` to stretch the whole session across
   * the scrollport. `"fit"` is a *mode*, not a cached number, so a resize or a
   * growing session re-fits automatically.
   */
  zoom: number | "fit";
  /** Horizontal scroll offset into the canvas, in px. */
  scrollLeft: number;
  /** Measured scrollport width, in px. */
  width: number;
}

export interface Bounds {
  t0: number;
  t1: number;
}

/** Merged active spans (idle between them is compressed to a gutter). */
export type ActiveSpans = ReadonlyArray<readonly [number, number]>;

/** Smallest usable scrollport; guards against measuring a hidden panel as 0. */
const MIN_WIDTH = 120;

export function resolveZoom(viewport: Viewport, bounds: Bounds, active: ActiveSpans): number {
  if (viewport.zoom !== "fit") return clamp(viewport.zoom, SCALE_MIN, SCALE_MAX);
  const width = Math.max(MIN_WIDTH, viewport.width);
  // Solve the px/ms whose projected session width equals the scrollport, under
  // the same idle-compressed scale the lanes draw with.
  return scaleForProjectedWidth(mutable(active), bounds.t0, bounds.t1, bounds.t0, bounds.t1, width);
}

/**
 * The scale spans the WHOLE session at the current zoom, so the canvas can be
 * wider than the scrollport and scroll horizontally. Building it across only
 * the visible window would make content exactly fill the viewport by
 * construction — leaving nothing to scroll.
 */
export function viewportScale(viewport: Viewport, bounds: Bounds, active: ActiveSpans): TimeScale {
  return buildScale(mutable(active), bounds.t0, bounds.t1, resolveZoom(viewport, bounds, active));
}

export function contentWidth(scale: TimeScale): number {
  return scale.width;
}

export function maxScroll(scale: TimeScale, width: number): number {
  return Math.max(0, scale.width - Math.max(MIN_WIDTH, width));
}

export function clampScroll(scrollLeft: number, scale: TimeScale, width: number): number {
  return clamp(scrollLeft, 0, maxScroll(scale, width));
}

/** The visible time window — derived, never stored. */
export function windowOf(scale: TimeScale, scrollLeft: number, width: number): TimeSpan {
  const w = Math.max(MIN_WIDTH, width);
  return {
    start: projectT(scale.segs, scrollLeft),
    end: projectT(scale.segs, scrollLeft + w),
  };
}

/** `buildScale` predates readonly tuples; keep the cast in exactly one place. */
function mutable(active: ActiveSpans): Array<[number, number]> {
  return active as Array<[number, number]>;
}
