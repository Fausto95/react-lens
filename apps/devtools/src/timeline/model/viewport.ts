/**
 * View window over the compressed axis: `{ a0, a1 }` in axis units.
 * Wall time is derived via the axis projectors — never stored as the window.
 */

import { clamp, type TimeAxis, type TimeSpan } from "./axis.js";
import { VIEW_SPAN_MIN } from "../view/metrics.js";

export interface ViewWindow {
  a0: number;
  a1: number;
}

export interface Bounds {
  t0: number;
  t1: number;
}

export type ActiveSpans = ReadonlyArray<readonly [number, number]>;

/** Smallest usable stage width. */
export const MIN_WIDTH = 120;

export function viewSpan(view: ViewWindow): number {
  return Math.max(VIEW_SPAN_MIN, view.a1 - view.a0);
}

export function clampView(a0: number, span: number, total: number): ViewWindow {
  const s = clamp(span, VIEW_SPAN_MIN, Math.max(VIEW_SPAN_MIN, total));
  const start = clamp(a0, 0, Math.max(0, total - s));
  return { a0: start, a1: start + s };
}

export function fitView(total: number): ViewWindow {
  return clampView(0, total, total);
}

/** Zoom by `factor` (<1 = in) around an axis anchor. */
export function zoomView(
  view: ViewWindow,
  factor: number,
  anchorA: number,
  total: number,
): ViewWindow {
  const span = viewSpan(view);
  const ns = clamp(span * factor, VIEW_SPAN_MIN, Math.max(VIEW_SPAN_MIN, total));
  const na0 = anchorA - ((anchorA - view.a0) / span) * ns;
  return clampView(na0, ns, total);
}

/** Fit a wall-time range with padding, mapped through the axis. */
export function fitWallRange(
  axis: TimeAxis,
  w0: number,
  w1: number,
  padFrac = 0.08,
): ViewWindow {
  const a0 = axis.wallToAxis(w0);
  const a1 = axis.wallToAxis(w1);
  const span = Math.max(VIEW_SPAN_MIN, a1 - a0);
  const pad = span * padFrac;
  return clampView(a0 - pad, span + pad * 2, axis.total);
}

/** Visible wall-time window for the current view. */
export function wallWindow(axis: TimeAxis, view: ViewWindow): TimeSpan {
  return {
    start: axis.axisToWall(view.a0),
    end: axis.axisToWall(view.a1),
  };
}

/** Linear interpolation for animated view transitions. */
export function lerpView(from: ViewWindow, to: ViewWindow, t: number): ViewWindow {
  const u = clamp(t, 0, 1);
  return {
    a0: from.a0 + (to.a0 - from.a0) * u,
    a1: from.a1 + (to.a1 - from.a1) * u,
  };
}

/**
 * After a gap morph, keep the wall-time center fixed and preserve span as a
 * fraction of total axis length.
 */
export function reanchorAfterAxisChange(
  prev: ViewWindow,
  prevTotal: number,
  next: TimeAxis,
  centerWall: number,
): ViewWindow {
  const spanFrac = viewSpan(prev) / Math.max(prevTotal, 1);
  const span = clamp(spanFrac * next.total, VIEW_SPAN_MIN, Math.max(VIEW_SPAN_MIN, next.total));
  const centerA = next.wallToAxis(centerWall);
  return clampView(centerA - span / 2, span, next.total);
}
