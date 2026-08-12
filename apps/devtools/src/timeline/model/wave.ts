/**
 * Dense lanes switch from stacked clips to a wave (occupancy histogram).
 */

export type LaneMode = "stack" | "wave";

/** Prototype: heavy + avg clip width < 7px → wave. */
export function laneMode(
  depth: number,
  clipCount: number,
  avgClipPx: number,
): LaneMode {
  const heavy = depth > 3 || clipCount > 60;
  return heavy && avgClipPx < 7 ? "wave" : "stack";
}

export interface WaveBin {
  count: number;
  wasted: number;
}

/**
 * Bin clips into columns of `binW` px across the plot area starting at `nameW`.
 */
export function waveBins(
  clips: ReadonlyArray<{ t0: number; t1: number; wasted: boolean }>,
  wallToX: (t: number) => number,
  nameW: number,
  stageW: number,
  binW = 3,
): { bins: WaveBin[]; max: number } {
  const n = Math.max(1, Math.ceil((stageW - nameW) / binW));
  const bins: WaveBin[] = Array.from({ length: n }, () => ({ count: 0, wasted: 0 }));
  for (const c of clips) {
    const x0 = wallToX(c.t0);
    const x1 = wallToX(c.t1);
    if (x1 < nameW || x0 > stageW) continue;
    const b0 = Math.max(0, Math.min(n - 1, Math.floor((x0 - nameW) / binW)));
    const b1 = Math.max(0, Math.min(n - 1, Math.floor((x1 - nameW) / binW)));
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
