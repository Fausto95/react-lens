/**
 * Viewport queries over TimelineIndex — stats via prefix sums, hit-test via
 * binary search, LOD selection by pixel width.
 */

import {
  CauseCode,
  LOD_BUCKET_MS,
  RenderFlags,
  lowerBound,
  upperBound,
  type LaneColumns,
  type LodBucket,
  type LodLevel,
  type TimelineIndex,
} from "./columnar.js";

export interface TimelineQuery {
  t0: number;
  t1: number;
  /** Inclusive lane row range in the ordered lane list (after filters). */
  rowStart: number;
  rowEnd: number;
  pixelWidth: number;
  /** Optional lane filter — return false to skip. */
  includeLane?: (laneKey: string, name: string) => boolean;
  /** Prefer buckets when avg event would be narrower than this (px). */
  lodEnterPx?: number;
}

export interface TimelineRowMeta {
  laneKey: string;
  name: string;
  yIndex: number;
  instanceCount: number;
  renders: number;
  wasted: number;
  selfTotal: number;
  depth: number;
  quiet: boolean;
}

export interface TimelineColumns {
  count: number;
  /** Lane index into rows[]. */
  rowIndex: Uint16Array;
  x0: Float64Array;
  x1: Float64Array;
  self: Float32Array;
  renderId: Uint32Array;
  componentId: Uint32Array;
  cause: Uint8Array;
  flags: Uint8Array;
  stackRow: Uint16Array;
}

export interface TimelineBucketColumns {
  count: number;
  rowIndex: Uint16Array;
  start: Float64Array;
  end: Float64Array;
  renderCount: Uint32Array;
  wastedCount: Uint32Array;
  selfTime: Float32Array;
  maxDuration: Float32Array;
}

export interface RegionStats {
  renders: number;
  wasted: number;
  selfMs: number;
}

export interface TimelineQueryResult {
  rows: TimelineRowMeta[];
  lod: "raw" | "buckets";
  lodBucketMs: number | null;
  columns: TimelineColumns | null;
  buckets: TimelineBucketColumns | null;
  stats: RegionStats;
  /** Busy intervals for gap-axis activity (from SUMMARY LOD). */
  activity: Array<[number, number]>;
}

const QUIET_TOTAL_MS = 8;
const DEFAULT_LOD_ENTER_PX = 1;

function pickLodLevel(spanMs: number, pixelWidth: number, enterPx: number): LodLevel | null {
  if (pixelWidth <= 0 || spanMs <= 0) return null;
  const msPerPx = spanMs / pixelWidth;
  // Use the coarsest bucket where bucket width in px is still >= enterPx.
  let best: LodLevel | null = null;
  for (let i = 0; i < LOD_BUCKET_MS.length; i++) {
    const bucketMs = LOD_BUCKET_MS[i]!;
    const bucketPx = bucketMs / msPerPx;
    if (bucketPx >= enterPx) best = i as LodLevel;
  }
  // Only switch to buckets when even L0 (1ms) would pack multiple events per pixel.
  if (best === null) return null;
  if (msPerPx < LOD_BUCKET_MS[0]! / Math.max(enterPx, 0.5)) return null;
  return best;
}

function sliceStats(lane: LaneColumns, t0: number, t1: number): RegionStats {
  if (lane.count === 0) return { renders: 0, wasted: 0, selfMs: 0 };
  const lo = lowerBound(lane.timestamps, lane.count, t0);
  // Include events that start before t1 (overlap: event may extend past).
  // For prefix sums we use events with timestamp in [t0, t1].
  const hi = upperBound(lane.timestamps, lane.count, t1);
  if (lo >= hi) return { renders: 0, wasted: 0, selfMs: 0 };
  return {
    renders: lane.countPrefix[hi]! - lane.countPrefix[lo]!,
    wasted: lane.wastedPrefix[hi]! - lane.wastedPrefix[lo]!,
    selfMs: lane.selfPrefix[hi]! - lane.selfPrefix[lo]!,
  };
}

/** O(log N) region stats across all (or filtered) lanes. */
export function statsInRange(
  index: TimelineIndex,
  t0: number,
  t1: number,
  options: {
    includeLane?: (laneKey: string, name: string) => boolean;
    excludeWasted?: boolean;
  } = {},
): RegionStats {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  let renders = 0;
  let wasted = 0;
  let selfMs = 0;
  for (const lane of index.lanes.values()) {
    if (options.includeLane && !options.includeLane(lane.laneKey, lane.name)) continue;
    const s = sliceStats(lane, lo, hi);
    if (options.excludeWasted) {
      renders += s.renders - s.wasted;
      selfMs += s.selfMs; // approximate: don't re-scan for non-wasted self
      // For exact non-wasted self we'd need a separate prefix; close enough for UI.
    } else {
      renders += s.renders;
      wasted += s.wasted;
      selfMs += s.selfMs;
    }
  }
  if (options.excludeWasted) wasted = 0;
  return { renders, wasted, selfMs };
}

export interface HitTestResult {
  renderId: number;
  componentId: number;
  laneKey: string;
  t0: number;
  t1: number;
  self: number;
  cause: number;
  wasted: boolean;
  stackRow: number;
}

/**
 * Nearest clip at time `t`. Prefer `preferLane` when set.
 * O(log N) per lane for the containing / nearest candidate.
 */
export function hitTest(
  index: TimelineIndex,
  t: number,
  preferLane: string | null = null,
): HitTestResult | null {
  let best: HitTestResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  const consider = (lane: LaneColumns) => {
    if (lane.count === 0) return;
    // Candidate around t: binary search, then scan a small window.
    let i = lowerBound(lane.timestamps, lane.count, t);
    if (i > 0) i--;
    const end = Math.min(lane.count, i + 8);
    for (let j = Math.max(0, i - 4); j < end; j++) {
      const t0 = lane.timestamps[j]!;
      const t1 = t0 + lane.durations[j]!;
      const containing = t0 <= t && t <= t1;
      const mid = (t0 + t1) / 2;
      let score = Math.abs(mid - t);
      if (containing) score *= 0.05;
      if (preferLane && lane.laneKey === preferLane) score *= 0.25;
      if (!containing && Math.abs(mid - t) > Math.max(t1 - t0, 80) * 4) continue;
      if (score < bestScore) {
        bestScore = score;
        best = {
          renderId: lane.renderIds[j]!,
          componentId: lane.componentIds[j]!,
          laneKey: lane.laneKey,
          t0,
          t1,
          self: lane.selfDurations[j]!,
          cause: lane.causes[j]!,
          wasted: (lane.flags[j]! & RenderFlags.Wasted) !== 0,
          stackRow: lane.rows[j]!,
        };
      }
    }
  };

  if (preferLane) {
    const lane = index.lanes.get(preferLane);
    if (lane) consider(lane);
  }
  for (const lane of index.lanes.values()) {
    if (preferLane && lane.laneKey === preferLane) continue;
    consider(lane);
  }
  return best;
}

function collectBuckets(
  lane: LaneColumns,
  level: LodLevel,
  t0: number,
  t1: number,
): LodBucket[] {
  const state = lane.lod[level];
  if (!state) return [];
  const out: LodBucket[] = [];
  for (const b of state.buckets.values()) {
    const end = b.start + state.bucketMs;
    if (end < t0 || b.start > t1) continue;
    out.push(b);
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Busy intervals from the coarsest LOD that still has signal (for gap axis). */
export function activityIntervals(
  index: TimelineIndex,
  bucketMs = 64,
): Array<[number, number]> {
  const levelIdx = LOD_BUCKET_MS.indexOf(bucketMs as (typeof LOD_BUCKET_MS)[number]);
  const level: LodLevel = (levelIdx >= 0 ? levelIdx : 3) as LodLevel;
  const starts = new Map<number, number>(); // start → end
  for (const lane of index.lanes.values()) {
    const state = lane.lod[level];
    if (!state) continue;
    for (const b of state.buckets.values()) {
      if (b.renderCount === 0) continue;
      const end = b.start + state.bucketMs;
      const prev = starts.get(b.start);
      starts.set(b.start, prev === undefined ? end : Math.max(prev, end));
    }
  }
  const sorted = [...starts.entries()].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of sorted) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + bucketMs * 0.25) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

export function queryTimeline(index: TimelineIndex, q: TimelineQuery): TimelineQueryResult {
  const t0 = Math.min(q.t0, q.t1);
  const t1 = Math.max(q.t0, q.t1);
  const enterPx = q.lodEnterPx ?? DEFAULT_LOD_ENTER_PX;
  const ordered = index.orderedLanes().filter((lane) => {
    if (q.includeLane && !q.includeLane(lane.laneKey, lane.name)) return false;
    return true;
  });

  const rowStart = Math.max(0, q.rowStart);
  const rowEnd = Math.min(ordered.length, Math.max(rowStart, q.rowEnd));
  const visibleLanes = ordered.slice(rowStart, rowEnd);

  const rows: TimelineRowMeta[] = visibleLanes.map((lane, i) => ({
    laneKey: lane.laneKey,
    name: lane.name,
    yIndex: rowStart + i,
    instanceCount: lane.instanceIds.size,
    renders: lane.count,
    wasted: lane.wastedCount,
    selfTotal: lane.selfTotal,
    depth: lane.maxRow + 1,
    quiet: lane.selfTotal < QUIET_TOTAL_MS,
  }));

  const stats = statsInRange(index, t0, t1, { includeLane: q.includeLane });
  const activity = activityIntervals(index);
  const spanMs = Math.max(1, t1 - t0);
  const lodLevel = pickLodLevel(spanMs, q.pixelWidth, enterPx);

  if (lodLevel !== null) {
    const bucketMs = LOD_BUCKET_MS[lodLevel]!;
    // Cap primitives
    let estimate = 0;
    const perLane: LodBucket[][] = [];
    for (const lane of visibleLanes) {
      const bs = collectBuckets(lane, lodLevel, t0, t1);
      perLane.push(bs);
      estimate += bs.length;
    }
    const cap = 10_000;
    const stride = estimate > cap ? Math.ceil(estimate / cap) : 1;
    let count = 0;
    for (const bs of perLane) count += Math.ceil(bs.length / stride);
    const rowIndex = new Uint16Array(count);
    const start = new Float64Array(count);
    const end = new Float64Array(count);
    const renderCount = new Uint32Array(count);
    const wastedCount = new Uint32Array(count);
    const selfTime = new Float32Array(count);
    const maxDuration = new Float32Array(count);
    let k = 0;
    for (let ri = 0; ri < perLane.length; ri++) {
      const bs = perLane[ri]!;
      for (let bi = 0; bi < bs.length; bi += stride) {
        const b = bs[bi]!;
        rowIndex[k] = ri;
        start[k] = b.start;
        end[k] = b.start + bucketMs;
        renderCount[k] = b.renderCount;
        wastedCount[k] = b.wastedCount;
        selfTime[k] = b.selfTime;
        maxDuration[k] = b.maxDuration;
        k++;
      }
    }
    return {
      rows,
      lod: "buckets",
      lodBucketMs: bucketMs,
      columns: null,
      buckets: { count: k, rowIndex, start, end, renderCount, wastedCount, selfTime, maxDuration },
      stats,
      activity,
    };
  }

  // Raw events in viewport
  let estimate = 0;
  const ranges: Array<{ lane: LaneColumns; lo: number; hi: number }> = [];
  for (const lane of visibleLanes) {
    const lo = lowerBound(lane.timestamps, lane.count, t0);
    // Also include events that started before t0 but may still overlap: walk back a bit.
    let start = lo;
    while (start > 0) {
      const prev = start - 1;
      const pt0 = lane.timestamps[prev]!;
      const pt1 = pt0 + lane.durations[prev]!;
      if (pt1 < t0) break;
      start = prev;
    }
    const hi = upperBound(lane.timestamps, lane.count, t1);
    ranges.push({ lane, lo: start, hi });
    estimate += Math.max(0, hi - start);
  }

  const cap = 10_000;
  const stride = estimate > cap ? Math.ceil(estimate / cap) : 1;
  let count = 0;
  for (const r of ranges) count += Math.ceil(Math.max(0, r.hi - r.lo) / stride);

  const rowIndex = new Uint16Array(count);
  const x0 = new Float64Array(count);
  const x1 = new Float64Array(count);
  const self = new Float32Array(count);
  const renderId = new Uint32Array(count);
  const componentId = new Uint32Array(count);
  const cause = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const stackRow = new Uint16Array(count);

  let k = 0;
  for (let ri = 0; ri < ranges.length; ri++) {
    const { lane, lo, hi } = ranges[ri]!;
    for (let i = lo; i < hi; i += stride) {
      const tStart = lane.timestamps[i]!;
      const dur = lane.durations[i]!;
      rowIndex[k] = ri;
      x0[k] = tStart;
      x1[k] = tStart + dur;
      self[k] = lane.selfDurations[i]!;
      renderId[k] = lane.renderIds[i]!;
      componentId[k] = lane.componentIds[i]!;
      cause[k] = lane.causes[i]!;
      flags[k] = lane.flags[i]!;
      stackRow[k] = lane.rows[i]!;
      k++;
    }
  }

  return {
    rows,
    lod: "raw",
    lodBucketMs: null,
    columns: {
      count: k,
      rowIndex,
      x0,
      x1,
      self,
      renderId,
      componentId,
      cause,
      flags,
      stackRow,
    },
    buckets: null,
    stats,
    activity,
  };
}

export function causeCodeToName(
  code: number,
): "props" | "state" | "context" | "cascade" | "mount" | "other" {
  switch (code) {
    case CauseCode.props:
      return "props";
    case CauseCode.state:
      return "state";
    case CauseCode.context:
      return "context";
    case CauseCode.cascade:
      return "cascade";
    case CauseCode.mount:
      return "mount";
    default:
      return "other";
  }
}
