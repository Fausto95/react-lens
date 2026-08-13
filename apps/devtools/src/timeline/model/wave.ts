/**
 * Dense lanes switch from stacked clips to a wave (occupancy histogram).
 *
 * Wave is a zoomed-out LOD: columns are time bins, bar *height* is concurrency
 * (how many clips overlap that column) — not one stem per instance. Zooming in
 * until average exclusive width clears WAVE_AVG_PX returns to stacked clips.
 *
 * Histogram columns use each clip's *exclusive* self window — inclusive
 * totalDuration would smear parents across their cascade and hide bursts.
 */

export type LaneMode = "stack" | "wave";

/**
 * Average painted clip width (px) below which heavy lanes use the histogram.
 * Zoom in (higher pxPerMs) raises avgClipPx → more lanes flip to stacked clips.
 *
 * Keep reachable at max zoom: `WAVE_LOD_MS * (plotW / VIEW_SPAN_MIN) >= WAVE_AVG_PX`
 * on a ~360px plot (0.2 × 360/5 = 14.4).
 */
export const WAVE_AVG_PX = 12;

/**
 * Re-enter wave only below this width. The 9–12 px band keeps the previous
 * mode so lanes don't flicker (and row heights don't jump) at the threshold.
 */
export const WAVE_ENTER_PX = 9;

/**
 * Min ms for LOD width when painted bars are tinier (near-zero-self leaves).
 * Ensures max zoom can still exit wave without forcing early clip mode.
 */
export const WAVE_LOD_MS = 0.2;

/** Painted bar width (ms) used for zoom-aware stack/wave — matches inclusive clips. */
export function lodClipMs(total: number): number {
  return Math.max(total, WAVE_LOD_MS);
}

/** Mean painted clip width in px at the current zoom. Grows as pxPerMs grows. */
export function avgClipWidthPx(clips: ReadonlyArray<{ total: number }>, pxPerMs: number): number {
  if (clips.length === 0) return 99;
  const sum = clips.reduce((a, c) => a + lodClipMs(c.total) * pxPerMs, 0);
  return sum / clips.length;
}

/**
 * Choose stack vs wave. Heavy lanes histogram only while painted marks are
 * still narrower than WAVE_AVG_PX — zooming in progressively reveals clips.
 * Inside the WAVE_ENTER_PX..WAVE_AVG_PX band the previous mode wins.
 */
export function laneMode(
  depth: number,
  clipCount: number,
  avgClipPx: number,
  prev?: LaneMode,
): LaneMode {
  const heavy = depth > 3 || clipCount > 60;
  if (!heavy || avgClipPx >= WAVE_AVG_PX) return "stack";
  if (avgClipPx < WAVE_ENTER_PX) return "wave";
  return prev ?? "wave";
}

export interface WaveBin {
  count: number;
  wasted: number;
}

/** Floor so sub-ms work still lights at least one column. */
export const WAVE_MIN_MS = 0.05;

export interface WaveClip {
  t0: number;
  /** Inclusive end — unused for binning; kept for callers that only have t0/t1. */
  t1: number;
  /** Exclusive self time (ms). When omitted, falls back to `t1 - t0`. */
  self?: number;
  wasted: boolean;
}

/**
 * Bin clips into columns of `binW` px across the plot area starting at `nameW`.
 * Each clip contributes only across `[t0, t0 + self]` (exclusive work).
 */
export function waveBins(
  clips: ReadonlyArray<WaveClip>,
  wallToX: (t: number) => number,
  nameW: number,
  stageW: number,
  binW = 3,
): { bins: WaveBin[]; max: number } {
  const plotW = Math.max(binW, stageW - nameW);
  const n = Math.max(1, Math.ceil(plotW / binW));
  const bins: WaveBin[] = Array.from({ length: n }, () => ({ count: 0, wasted: 0 }));

  for (const c of clips) {
    const selfMs = Math.max(c.self !== undefined ? c.self : c.t1 - c.t0, WAVE_MIN_MS);
    const x0 = wallToX(c.t0);
    const x1 = wallToX(c.t0 + selfMs);
    // Fully outside the plot.
    if (x1 < nameW || x0 > stageW) continue;

    // Cover every column the exclusive span touches; sub-pixel work still gets
    // one column so short renders aren't dropped between bins.
    let b0 = Math.floor((x0 - nameW) / binW);
    let b1 = Math.floor((x1 - nameW) / binW);
    if (!Number.isFinite(b0) || !Number.isFinite(b1)) continue;
    if (b1 < b0) b1 = b0;
    b0 = Math.max(0, Math.min(n - 1, b0));
    b1 = Math.max(0, Math.min(n - 1, b1));

    for (let b = b0; b <= b1; b++) {
      const bin = bins[b]!;
      bin.count++;
      if (c.wasted) bin.wasted++;
    }
  }

  let max = 1;
  for (const b of bins) if (b.count > max) max = b.count;
  return { bins, max };
}
