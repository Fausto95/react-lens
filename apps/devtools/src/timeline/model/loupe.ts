/**
 * Loupe: a ±HALF ms wall window over one wave lane for hover magnification.
 */

import type { TimeAxis } from "./axis.js";
import { WAVE_MIN_MS } from "./wave.js";

export const LOUPE_HALF_MS = 34;
export const LOUPE_W = 288;
export const LOUPE_H = 46;
/** Rendered panel width — canvas plus borders. */
export const LOUPE_PANEL_W = LOUPE_W + 4;
/** Gap between the panel and the hovered row / stage edges. */
const LOUPE_MARGIN = 4;
/** Panel height above the row: head (16) + canvas (46) hover clearance. */
const LOUPE_LIFT = 52;

export interface LoupeWindow {
  laneKey: string;
  wallT: number;
  t0: number;
  t1: number;
}

/**
 * Build a loupe window around `wallT`, clamped to the activity segment that
 * contains it so the preview never includes compressed-away idle.
 */
export function loupeAt(
  laneKey: string,
  wallT: number,
  half = LOUPE_HALF_MS,
  axis?: TimeAxis,
): LoupeWindow {
  let t0 = wallT - half;
  let t1 = wallT + half;
  if (axis) {
    const act = axis.segs.find((s) => s.type === "act" && wallT >= s.w0 && wallT <= s.w1);
    if (act && act.type === "act") {
      t0 = Math.max(t0, act.w0);
      t1 = Math.min(t1, act.w1);
      if (t1 <= t0) {
        t0 = Math.max(act.w0, wallT - half);
        t1 = Math.min(act.w1, wallT + half);
      }
    }
  }
  return { laneKey, wallT, t0, t1 };
}

export function clipsInLoupe<T extends { t0: number; t1: number }>(
  clips: readonly T[],
  win: LoupeWindow,
): T[] {
  return clips.filter((c) => c.t1 >= win.t0 && c.t0 <= win.t1);
}

/**
 * Anchor the loupe panel in the stage's scrolled CONTENT coordinates:
 * centered on the cursor, clamped inside the stage, and never above the
 * scrolled viewport top (`scrollTop`), which is where absolute children live.
 */
export function loupeAnchor(
  cursorX: number,
  rowY: number,
  scrollTop: number,
  nameW: number,
  stageW: number,
): { x: number; top: number } {
  const lo = nameW + LOUPE_MARGIN;
  const hi = Math.max(lo, stageW - LOUPE_PANEL_W - LOUPE_MARGIN);
  const x = Math.min(Math.max(cursorX - LOUPE_PANEL_W / 2, lo), hi);
  const top = Math.max(rowY - LOUPE_LIFT, scrollTop + 2);
  return { x, top };
}

/**
 * Half-window for click-to-zoom. Shrinks below LOUPE_HALF_MS once the view is
 * already tighter than the loupe window, so clicking never zooms out.
 */
export function loupeZoomHalf(viewSpanAxis: number, half = LOUPE_HALF_MS): number {
  return Math.min(half, viewSpanAxis / 4);
}

/**
 * The span a loupe bar paints — the exclusive self window, floored like
 * waveBins. Inclusive `t1` would draw wide bars where the wave shows a thin
 * column.
 */
export function loupeBarSpan(clip: { t0: number; t1: number; self?: number }): {
  t0: number;
  t1: number;
} {
  const selfMs = Math.max(clip.self ?? clip.t1 - clip.t0, WAVE_MIN_MS);
  return { t0: clip.t0, t1: clip.t0 + selfMs };
}

/** Map wall time → x inside the loupe canvas. */
export function loupeX(t: number, win: LoupeWindow, width = LOUPE_W): number {
  return ((t - win.t0) / (win.t1 - win.t0 || 1)) * width;
}
