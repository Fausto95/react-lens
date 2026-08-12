/**
 * Compatibility re-exports. New code should import from `axis.js` / `viewport.js`.
 */

export {
  clamp,
  mergeActive,
  type TimeSpan,
  buildAxis,
  buildActivity,
  gapAxisLen,
  niceStep,
  compactGap,
  easeOut,
  type TimeAxis,
  type AxisSeg,
} from "./axis.js";

/** @deprecated Use IDLE_MS from metrics — kept for older tests. */
export const IDLE_GAP_MS = 200;
/** @deprecated Use GAP_AXIS_SEAM from metrics (now 0 — fully compressed). */
export const IDLE_WIDTH = 0;

export const SCALE_MAX = 5000;
export const SCALE_MIN = 0.01;
export const INNER_RIGHT_PAD = 90;
export const PANE_MIN_H = 100;
export const PANE_MAX_H = 520;

export function clampPaneHeight(h: number): number {
  return Math.max(PANE_MIN_H, Math.min(PANE_MAX_H, Math.round(h)));
}
