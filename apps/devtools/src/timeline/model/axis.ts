/**
 * Non-linear time axis: activity at true scale, idle gaps collapsed (and
 * optionally expanded back toward wall time via per-gap progress).
 */

import { GAP_AXIS_SEAM, IDLE_MS } from "../view/metrics.js";

/** Anything with a start/end in session time. */
export interface TimeSpan {
  start: number;
  end: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export type AxisSeg =
  | { type: "act"; w0: number; w1: number; a0: number; a1: number }
  | { type: "gap"; id: string; w0: number; w1: number; a0: number; a1: number; p: number };

export interface TimeAxis {
  segs: AxisSeg[];
  /** Total axis length (same units as wall ms when gaps are fully expanded). */
  total: number;
  wallToAxis: (t: number) => number;
  axisToWall: (x: number) => number;
  w0: number;
  w1: number;
}

/** Merge overlapping/near spans into activity intervals. */
export function mergeActive(spans: readonly TimeSpan[], idleMs = IDLE_MS): Array<[number, number]> {
  const ivals = spans
    .map((i) => [i.start, Math.max(i.end, i.start + 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ivals) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= idleMs) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * Activity bands from clip/marker intervals, with ±40 ms padding (prototype).
 * Gaps longer than `idleMs` become collapsible gutters.
 */
export function buildActivity(
  intervals: ReadonlyArray<readonly [number, number]>,
  idleMs = IDLE_MS,
): Array<[number, number]> {
  if (intervals.length === 0) return [[0, 1]];
  const iv = [...intervals].sort((a, b) => a[0] - b[0]);
  const acts: Array<[number, number]> = [];
  let [s, e] = iv[0]!;
  for (let k = 1; k < iv.length; k++) {
    const [a, b] = iv[k]!;
    if (a - e > idleMs) {
      acts.push([s, e]);
      [s, e] = [a, b];
    } else e = Math.max(e, b);
  }
  acts.push([s, e]);
  return acts.map(([a, b]) => [Math.max(0, a - 40), b + 40] as [number, number]);
}

/** Collapsed gap length on the axis — fully compressed (no idle width). */
export function gapAxisLen(_ms: number): number {
  return GAP_AXIS_SEAM;
}

/**
 * Build the axis. `progress` maps gap id → 0 (collapsed) … 1 (true wall scale).
 */
export function buildAxis(
  acts: ReadonlyArray<readonly [number, number]>,
  progress: ReadonlyMap<string, number> = new Map(),
): TimeAxis {
  if (acts.length === 0) {
    const segs: AxisSeg[] = [{ type: "act", w0: 0, w1: 1, a0: 0, a1: 1 }];
    return {
      segs,
      total: 1,
      wallToAxis: () => 0,
      axisToWall: () => 0,
      w0: 0,
      w1: 1,
    };
  }

  const segs: AxisSeg[] = [];
  let a = 0;
  for (let i = 0; i < acts.length; i++) {
    if (i > 0) {
      const w0 = acts[i - 1]![1];
      const w1 = acts[i]![0];
      const id = "g" + i;
      const p = progress.get(id) ?? 0;
      const len = gapAxisLen(w1 - w0) * (1 - p) + (w1 - w0) * p;
      segs.push({ type: "gap", id, w0, w1, a0: a, a1: a + len, p });
      a += len;
    }
    const [w0, w1] = acts[i]!;
    segs.push({ type: "act", w0, w1, a0: a, a1: a + (w1 - w0) });
    a += w1 - w0;
  }

  const wallToAxis = (t: number): number => {
    if (t <= segs[0]!.w0) return 0;
    for (const s of segs) {
      // Fully compressed idle: collapse interior wall times to the stitch
      // point, but leave t === w1 for the following activity segment.
      if (s.type === "gap" && s.a1 - s.a0 < 1e-9) {
        if (t > s.w0 && t < s.w1) return s.a0;
        continue;
      }
      if (t <= s.w1) {
        return s.a0 + ((t - s.w0) / (s.w1 - s.w0 || 1)) * (s.a1 - s.a0);
      }
    }
    return a;
  };

  const axisToWall = (x: number): number => {
    if (x <= 0) return segs[0]!.w0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      if (s.type === "gap" && s.a1 - s.a0 < 1e-9) continue;
      if (x <= s.a1) {
        // Shared stitch with a following zero-width gap: prefer the next
        // activity so scrubbing lands on content, not the previous act's end.
        const next = segs[i + 1];
        const next2 = segs[i + 2];
        if (
          Math.abs(x - s.a1) < 1e-9 &&
          next?.type === "gap" &&
          next.a1 - next.a0 < 1e-9 &&
          next2?.type === "act"
        ) {
          continue;
        }
        return s.w0 + ((x - s.a0) / (s.a1 - s.a0 || 1)) * (s.w1 - s.w0);
      }
    }
    return segs[segs.length - 1]!.w1;
  };

  return {
    segs,
    total: a,
    wallToAxis,
    axisToWall,
    w0: segs[0]!.w0,
    w1: segs[segs.length - 1]!.w1,
  };
}

export function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Compact gap chip label. */
export function compactGap(msVal: number): string {
  if (msVal >= 60_000) return `${Math.round(msVal / 60_000)}m`;
  if (msVal >= 1000) {
    const s = msVal / 1000;
    return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
  }
  return `${Math.round(msVal)}ms`;
}
