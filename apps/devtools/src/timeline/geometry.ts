/**
 * Pure timeline geometry: the non-linear time scale (idle gaps compressed to
 * fixed gutters), projections between time and pixels, and layout helpers.
 * No React, no store — everything here is plain data in, plain data out.
 */

/** Anything with a start/end in session time (structural slice of Interaction). */
export interface TimeSpan {
  start: number;
  end: number;
}

export const IDLE_GAP_MS = 400;
export const IDLE_WIDTH = 34;
/** Right-edge breathing room so end-of-session boxes and labels never crop. */
export const INNER_RIGHT_PAD = 90;
/** Manual / fit zoom ceiling (px per ms). Short interactions need headroom past 200. */
export const SCALE_MAX = 5000;
/** Floor (px per ms) for zoom controls. */
export const SCALE_MIN = 0.01;

export interface Seg {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
  idle: boolean;
}

export interface TimeScale {
  segs: Seg[];
  width: number;
}

export function mergeActive(spans: readonly TimeSpan[]): Array<[number, number]> {
  const ivals = spans
    .map((i) => [i.start, Math.max(i.end, i.start + 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ivals) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= IDLE_GAP_MS) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function countIdleGutters(active: Array<[number, number]>, t0: number, t1: number): number {
  let n = 0;
  let cursor = t0;
  for (const [s, e] of active) {
    if (s > cursor) n++;
    cursor = e;
  }
  if (t1 > cursor) n++;
  return n;
}

export function buildScale(
  active: Array<[number, number]>,
  t0: number,
  t1: number,
  px: number,
  /** When set (auto-fit), stretch so total width matches the viewport. */
  fillWidth?: number,
): TimeScale {
  const segs: Seg[] = [];
  let x = 0;
  let cursor = t0;
  const push = (a: number, b: number, w: number, idle: boolean) => {
    segs.push({ t0: a, t1: b, x0: x, x1: x + w, idle });
    x += w;
  };
  for (const [s, e] of active) {
    if (s > cursor) push(cursor, s, IDLE_WIDTH, true);
    push(s, e, Math.max(4, (e - s) * px), false);
    cursor = e;
  }
  if (t1 > cursor) push(cursor, t1, IDLE_WIDTH, true);
  if (segs.length === 0) push(t0, t1, Math.max(320, (t1 - t0) * px), false);

  // Auto-fit: if rounding/`Math.max(4, …)` left us short, pad the last active seg.
  if (fillWidth !== undefined && x < fillWidth && segs.length > 0) {
    const pad = fillWidth - x;
    let target = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (!segs[i]!.idle) {
        target = i;
        break;
      }
    }
    if (target < 0) target = segs.length - 1;
    for (let i = target; i < segs.length; i++) {
      const s = segs[i]!;
      if (i === target) {
        s.x1 += pad;
      } else {
        s.x0 += pad;
        s.x1 += pad;
      }
    }
    x = fillWidth;
  }

  return { segs, width: fillWidth !== undefined ? Math.max(x, fillWidth) : Math.max(320, x) };
}

export function projectX(segs: Seg[], t: number): number {
  for (const s of segs) {
    if (t <= s.t1) {
      const frac = s.t1 === s.t0 ? 0 : (t - s.t0) / (s.t1 - s.t0);
      return s.x0 + clamp(frac, 0, 1) * (s.x1 - s.x0);
    }
  }
  const last = segs[segs.length - 1];
  return last ? last.x1 : 0;
}

export function projectT(segs: Seg[], x: number): number {
  for (const s of segs) {
    if (x <= s.x1) {
      const frac = s.x1 === s.x0 ? 0 : (x - s.x0) / (s.x1 - s.x0);
      return s.t0 + clamp(frac, 0, 1) * (s.t1 - s.t0);
    }
  }
  const last = segs[segs.length - 1];
  return last ? last.t1 : 0;
}

/**
 * Solve for px/ms so the projected width of [rangeStart, rangeEnd] matches
 * `targetWidth` under the compressed (idle-gutter) scale.
 */
export function scaleForProjectedWidth(
  active: Array<[number, number]>,
  t0: number,
  t1: number,
  rangeStart: number,
  rangeEnd: number,
  targetWidth: number,
): number {
  const widthAt = (px: number) => {
    const model = buildScale(active, t0, t1, px);
    return projectX(model.segs, rangeEnd) - projectX(model.segs, rangeStart);
  };
  // Monotone in px for ranges that fall on active time; binary-search the match.
  let lo = SCALE_MIN;
  let hi = SCALE_MAX;
  if (widthAt(lo) >= targetWidth) return lo;
  if (widthAt(hi) <= targetWidth) return hi;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (widthAt(mid) < targetWidth) lo = mid;
    else hi = mid;
  }
  return clamp((lo + hi) / 2, SCALE_MIN, SCALE_MAX);
}

/** Resizable waterfall-lane bounds (px). */
export const PANE_MIN_H = 100;
export const PANE_MAX_H = 520;

export function clampPaneHeight(h: number): number {
  return clamp(Math.round(h), PANE_MIN_H, PANE_MAX_H);
}

export interface FitPlan {
  scale: number;
  scrollLeft: number;
}

/**
 * Zoom-to-range: solve the scale that projects [start, end] to ~85% of the
 * viewport and the scrollLeft that centers it. Sub-frame ranges expand to a
 * 16ms context window so the zoom stays usable.
 */
export function fitPlan(
  active: Array<[number, number]>,
  bounds: { t0: number; t1: number },
  range: TimeSpan,
  portW: number,
): FitPlan {
  const span = Math.max(0, range.end - range.start);
  const window = Math.max(span, 16);
  const pad = (window - span) / 2;
  const rangeStart = clamp(range.start - pad, bounds.t0, bounds.t1);
  const rangeEnd = clamp(Math.max(range.end, range.start) + pad, bounds.t0, bounds.t1);
  const targetW = Math.max(80, portW * 0.85);
  const scale = scaleForProjectedWidth(active, bounds.t0, bounds.t1, rangeStart, rangeEnd, targetW);
  const built = buildScale(active, bounds.t0, bounds.t1, scale);
  const x0 = projectX(built.segs, rangeStart);
  const x1 = projectX(built.segs, rangeEnd);
  return { scale, scrollLeft: Math.max(0, (x0 + x1) / 2 - portW / 2) };
}

export function sessionBounds(
  spans: readonly TimeSpan[],
  points: ReadonlyArray<{ timestamp: number }>,
): { t0: number; t1: number; span: number } {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const it of spans) {
    t0 = Math.min(t0, it.start);
    t1 = Math.max(t1, it.end);
  }
  for (const c of points) {
    t0 = Math.min(t0, c.timestamp);
    t1 = Math.max(t1, c.timestamp);
  }
  if (!isFinite(t0)) {
    t0 = 0;
    t1 = 1;
  }
  return { t0, t1, span: Math.max(1, t1 - t0) };
}

/** Keep a bar label in the visible scrollport while the bar itself is on-screen. */
export function stickyLabelShift(barLeft: number, barWidth: number, scrollLeft: number): number {
  const hidden = scrollLeft - barLeft;
  if (hidden <= 0) return 0;
  // Leave room so the label doesn't shove the trailing ms off the bar.
  const maxShift = Math.max(0, barWidth - 56);
  return Math.min(hidden, maxShift);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function nearest<T extends TimeSpan>(spans: readonly T[], t: number): T | null {
  let best: T | null = null;
  let dist = Infinity;
  for (const it of spans) {
    const d = t < it.start ? it.start - t : t > it.end ? t - it.end : 0;
    if (d < dist) {
      dist = d;
      best = it;
    }
  }
  return best;
}
