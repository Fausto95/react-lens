/**
 * Loupe: a ±HALF ms wall window over one wave lane for hover magnification.
 */

export const LOUPE_HALF_MS = 34;
export const LOUPE_W = 288;
export const LOUPE_H = 46;

export interface LoupeWindow {
  laneKey: string;
  wallT: number;
  t0: number;
  t1: number;
}

export function loupeAt(laneKey: string, wallT: number, half = LOUPE_HALF_MS): LoupeWindow {
  return { laneKey, wallT, t0: wallT - half, t1: wallT + half };
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
