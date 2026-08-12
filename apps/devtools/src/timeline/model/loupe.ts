/**
 * Loupe: a ±HALF ms wall window over one wave lane for hover magnification.
 */

import type { TimeAxis } from "./axis.js";

export const LOUPE_HALF_MS = 34;
export const LOUPE_W = 288;
export const LOUPE_H = 46;

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

/** Map wall time → x inside the loupe canvas. */
export function loupeX(t: number, win: LoupeWindow, width = LOUPE_W): number {
  return ((t - win.t0) / (win.t1 - win.t0 || 1)) * width;
}
