/**
 * View window over the compressed axis: `{ a0, a1 }` in axis units.
 * Wall time is derived via the axis projectors — never stored as the window.
 */

import { clamp, type TimeAxis, type TimeSpan } from "./axis.js";
import { VIEW_SPAN_MAX, VIEW_SPAN_MIN } from "../view/metrics.js";

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

/** Furthest zoom-out span for an axis of length `total`. */
export function maxViewSpan(total: number): number {
  return Math.max(VIEW_SPAN_MIN, total, VIEW_SPAN_MAX);
}

export function viewSpan(view: ViewWindow): number {
  return Math.max(VIEW_SPAN_MIN, view.a1 - view.a0);
}

export function clampView(a0: number, span: number, total: number): ViewWindow {
  const t = Math.max(0, total);
  const s = clamp(span, VIEW_SPAN_MIN, maxViewSpan(t));
  // When s > t, allow negative a0 so content can sit centered with empty margins.
  const start = clamp(a0, Math.min(0, t - s), Math.max(0, t - s));
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
  const t = Math.max(0, total);
  const span = viewSpan(view);
  const ns = clamp(span * factor, VIEW_SPAN_MIN, maxViewSpan(t));
  const na0 = anchorA - ((anchorA - view.a0) / span) * ns;
  return clampView(na0, ns, t);
}

/** Fit a wall-time range with padding, mapped through the axis. */
export function fitWallRange(axis: TimeAxis, w0: number, w1: number, padFrac = 0.08): ViewWindow {
  const a0 = axis.wallToAxis(Math.min(w0, w1));
  const a1 = axis.wallToAxis(Math.max(w0, w1));
  const span = Math.max(VIEW_SPAN_MIN, a1 - a0);
  const pad = span * padFrac;
  return clampView(a0 - pad, span + pad * 2, axis.total);
}

/**
 * Fit a wall range but keep `centerW` at the view midpoint.
 * Loupe zoom must preserve the crosshair (hover time), not the [t0,t1] midpoint —
 * clamping to an activity segment makes those diverge.
 */
export function fitWallRangeAround(
  axis: TimeAxis,
  w0: number,
  w1: number,
  centerW: number,
  padFrac = 0.12,
): ViewWindow {
  const a0 = axis.wallToAxis(Math.min(w0, w1));
  const a1 = axis.wallToAxis(Math.max(w0, w1));
  const span = Math.max(VIEW_SPAN_MIN, a1 - a0);
  const pad = span * padFrac;
  const total = span + pad * 2;
  const centerA = axis.wallToAxis(centerW);
  return clampView(centerA - total / 2, total, axis.total);
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
  const span = clamp(spanFrac * next.total, VIEW_SPAN_MIN, maxViewSpan(next.total));
  const centerA = next.wallToAxis(centerWall);
  return clampView(centerA - span / 2, span, next.total);
}
