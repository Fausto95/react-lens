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
  /** Serializable view-only lane filter for worker queries. */
  laneFilter?: {
    solo?: readonly string[];
    muted?: readonly string[];
  };
  /** Include quiet lanes in row windows. Defaults to true. */
  includeQuiet?: boolean;
  /** Include stats in the query response. Defaults to true for compatibility. */
  includeStats?: boolean;
  /** Include busy activity intervals in the query response. Defaults to true. */
  includeActivity?: boolean;
  /** Prefer buckets when avg event would be narrower than this (px). */
  lodEnterPx?: number;
}

export interface TimelineRowMeta {
  laneKey: string;
  name: string;
  yIndex: number;
  firstT: number;
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
  rowIndex: Uint32Array;
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
  rowIndex: Uint32Array;
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

export interface RegionStatsPair {
  raw: RegionStats;
  excludeWasted: RegionStats;
}

export interface TimelineQuietSummary {
  lanes: number;
  renders: number;
  selfMs: number;
}

export interface TimelineQueryResult {
  rows: TimelineRowMeta[];
  /** Rows after filtering, before rowStart/rowEnd slicing. */
  totalRows: number;
  lod: "raw" | "buckets";
  lodBucketMs: number | null;
  columns: TimelineColumns | null;
  buckets: TimelineBucketColumns | null;
  stats: RegionStats;
  quietSummary: TimelineQuietSummary;
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

function sliceStatsWithWastedSelf(
  lane: LaneColumns,
  t0: number,
  t1: number,
): RegionStats & { wastedSelfMs: number } {
  if (lane.count === 0) return { renders: 0, wasted: 0, selfMs: 0, wastedSelfMs: 0 };
  const lo = lowerBound(lane.timestamps, lane.count, t0);
  const hi = upperBound(lane.timestamps, lane.count, t1);
  if (lo >= hi) return { renders: 0, wasted: 0, selfMs: 0, wastedSelfMs: 0 };
  return {
    renders: lane.countPrefix[hi]! - lane.countPrefix[lo]!,
    wasted: lane.wastedPrefix[hi]! - lane.wastedPrefix[lo]!,
    selfMs: lane.selfPrefix[hi]! - lane.selfPrefix[lo]!,
    wastedSelfMs: lane.wastedSelfPrefix[hi]! - lane.wastedSelfPrefix[lo]!,
  };
}

function globalStats(
  index: TimelineIndex,
  t0: number,
  t1: number,
): RegionStats & { wastedSelfMs: number } {
  if (index.count === 0) return { renders: 0, wasted: 0, selfMs: 0, wastedSelfMs: 0 };
  const lo = lowerBound(index.timestamps, index.count, t0);
  const hi = upperBound(index.timestamps, index.count, t1);
  if (lo >= hi) return { renders: 0, wasted: 0, selfMs: 0, wastedSelfMs: 0 };
  return {
    renders: index.countPrefix[hi]! - index.countPrefix[lo]!,
    wasted: index.wastedPrefix[hi]! - index.wastedPrefix[lo]!,
    selfMs: index.selfPrefix[hi]! - index.selfPrefix[lo]!,
    wastedSelfMs: index.wastedSelfPrefix[hi]! - index.wastedSelfPrefix[lo]!,
  };
}

interface CompiledLaneFilter {
  muted: ReadonlySet<string>;
  solo: readonly string[];
  soloSet: ReadonlySet<string>;
  soloChains: ReadonlyArray<ReadonlySet<string>>;
}

function compileLaneFilter(
  filter: TimelineQuery["laneFilter"] | undefined,
): CompiledLaneFilter | null {
  if (!filter) return null;
  const solo = filter.solo ?? [];
  return {
    muted: new Set(filter.muted ?? []),
    solo,
    soloSet: new Set(solo),
    soloChains: solo.map((key) => new Set(laneChain(key))),
  };
}

function laneChain(key: string): string[] {
  if (!key.startsWith("i:")) return [key];
  const body = key.slice(2);
  const cut = body.lastIndexOf("#");
  if (cut < 0) return [key];
  return [`t:${body.slice(0, cut)}`, key];
}

function laneFilterPasses(filter: CompiledLaneFilter | null, laneKey: string): boolean {
  if (!filter) return true;
  const chain = laneChain(laneKey);
  if (chain.some((key) => filter.muted.has(key))) return false;
  const solo = filter.solo;
  if (solo.length === 0) return true;
  if (chain.some((key) => filter.soloSet.has(key))) return true;
  for (const soloChain of filter.soloChains) {
    if (soloChain.has(laneKey)) return true;
  }
  return false;
}

function includePasses(
  q: Pick<TimelineQuery, "includeLane" | "laneFilter">,
  lane: LaneColumns,
  compiledFilter: CompiledLaneFilter | null,
): boolean {
  if (q.includeLane && !q.includeLane(lane.laneKey, lane.name)) return false;
  return laneFilterPasses(compiledFilter, lane.laneKey);
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
  if (!options.includeLane) {
    const s = globalStats(index, lo, hi);
    if (!options.excludeWasted) return { renders: s.renders, wasted: s.wasted, selfMs: s.selfMs };
    return {
      renders: s.renders - s.wasted,
      wasted: 0,
      selfMs: s.selfMs - s.wastedSelfMs,
    };
  }

  let renders = 0;
  let wasted = 0;
  let selfMs = 0;
  for (const lane of index.lanes.values()) {
    if (options.includeLane && !options.includeLane(lane.laneKey, lane.name)) continue;
    const s = sliceStatsWithWastedSelf(lane, lo, hi);
    if (options.excludeWasted) {
      renders += s.renders - s.wasted;
      selfMs += s.selfMs - s.wastedSelfMs;
    } else {
      renders += s.renders;
      wasted += s.wasted;
      selfMs += s.selfMs;
    }
  }
  if (options.excludeWasted) wasted = 0;
  return { renders, wasted, selfMs };
}

/** Compute raw + exclude-wasted stats in one pass. */
export function statsPairInRange(
  index: TimelineIndex,
  t0: number,
  t1: number,
  options: {
    includeLane?: (laneKey: string, name: string) => boolean;
  } = {},
): RegionStatsPair {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  if (!options.includeLane) {
    const s = globalStats(index, lo, hi);
    return {
      raw: { renders: s.renders, wasted: s.wasted, selfMs: s.selfMs },
      excludeWasted: {
        renders: s.renders - s.wasted,
        wasted: 0,
        selfMs: s.selfMs - s.wastedSelfMs,
      },
    };
  }

  let renders = 0;
  let wasted = 0;
  let selfMs = 0;
  let keptRenders = 0;
  let keptSelfMs = 0;
  for (const lane of index.lanes.values()) {
    if (!options.includeLane(lane.laneKey, lane.name)) continue;
    const s = sliceStatsWithWastedSelf(lane, lo, hi);
    renders += s.renders;
    wasted += s.wasted;
    selfMs += s.selfMs;
    keptRenders += s.renders - s.wasted;
    keptSelfMs += s.selfMs - s.wastedSelfMs;
  }
  return {
    raw: { renders, wasted, selfMs },
    excludeWasted: { renders: keptRenders, wasted: 0, selfMs: keptSelfMs },
  };
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

export interface HitTestOptions {
  includeLane?: (laneKey: string, name: string) => boolean;
  laneFilter?: TimelineQuery["laneFilter"];
  includeQuiet?: boolean;
  rowStart?: number;
  rowEnd?: number;
}

/**
 * Nearest clip at time `t`. Prefer `preferLane` when set.
 * O(log N) per lane for the containing / nearest candidate.
 */
export function hitTest(
  index: TimelineIndex,
  t: number,
  preferLane: string | null = null,
  options: HitTestOptions = {},
): HitTestResult | null {
  let best: HitTestResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const compiledFilter = compileLaneFilter(options.laneFilter);
  const hasLaneWindow =
    options.includeLane ||
    compiledFilter ||
    options.includeQuiet === false ||
    options.rowStart !== undefined ||
    options.rowEnd !== undefined;

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
    if (
      lane &&
      includePasses(
        { includeLane: options.includeLane, laneFilter: options.laneFilter },
        lane,
        compiledFilter,
      )
    ) {
      consider(lane);
    }
  }
  const lanes = hasLaneWindow
    ? (() => {
        const base = index.orderedLanes({
          includeQuiet: options.includeQuiet,
          quietTotalMs: QUIET_TOTAL_MS,
        });
        const filtered =
          options.includeLane || compiledFilter
            ? base.filter((lane) =>
                includePasses(
                  { includeLane: options.includeLane, laneFilter: options.laneFilter },
                  lane,
                  compiledFilter,
                ),
              )
            : base;
        const rowStart = Math.max(0, options.rowStart ?? 0);
        const rowEnd = Math.min(
          filtered.length,
          Math.max(rowStart, options.rowEnd ?? filtered.length),
        );
        return filtered.slice(rowStart, rowEnd);
      })()
    : index.lanes.values();
  for (const lane of lanes) {
    if (preferLane && lane.laneKey === preferLane) continue;
    consider(lane);
  }
  return best;
}

function collectBuckets(lane: LaneColumns, level: LodLevel, t0: number, t1: number): LodBucket[] {
  const state = lane.lod[level];
  if (!state) return [];
  const out: LodBucket[] = [];
  if (!state.startsSorted) {
    state.starts.sort((a, b) => a - b);
    state.startsSorted = true;
  }
  const lo = lowerBound(state.starts, state.starts.length, t0 - state.bucketMs);
  const hi = upperBound(state.starts, state.starts.length, t1);
  for (let i = lo; i < hi; i++) {
    const b = state.buckets.get(state.starts[i]!);
    if (!b) continue;
    const end = b.start + state.bucketMs;
    if (end < t0 || b.start > t1) continue;
    out.push(b);
  }
  return out;
}

/** Busy intervals from the coarsest LOD that still has signal (for gap axis). */
export function activityIntervals(index: TimelineIndex, bucketMs = 64): Array<[number, number]> {
  const levelIdx = LOD_BUCKET_MS.indexOf(bucketMs as (typeof LOD_BUCKET_MS)[number]);
  const level: LodLevel = (levelIdx >= 0 ? levelIdx : 3) as LodLevel;
  const state = index.activityLod[level];
  if (!state) return [];
  if (!state.startsSorted) {
    state.starts.sort((a, b) => a - b);
    state.startsSorted = true;
  }
  const merged: Array<[number, number]> = [];
  for (const s of state.starts) {
    const b = state.buckets.get(s);
    if (!b || b.renderCount === 0) continue;
    const e = b.start + state.bucketMs;
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
  const includeQuiet = q.includeQuiet ?? true;
  const compiledFilter = compileLaneFilter(q.laneFilter);
  const hasLaneFilter = !!q.includeLane || !!compiledFilter;
  const baseOrdered = index.orderedLanes({ includeQuiet, quietTotalMs: QUIET_TOTAL_MS });
  const ordered = hasLaneFilter
    ? baseOrdered.filter((lane) => includePasses(q, lane, compiledFilter))
    : baseOrdered;

  const rowStart = Math.max(0, q.rowStart);
  const rowEnd = Math.min(ordered.length, Math.max(rowStart, q.rowEnd));
  const visibleLanes = ordered.slice(rowStart, rowEnd);

  const rows: TimelineRowMeta[] = visibleLanes.map((lane, i) => ({
    laneKey: lane.laneKey,
    name: lane.name,
    yIndex: rowStart + i,
    firstT: Number.isFinite(lane.firstT) ? lane.firstT : 0,
    instanceCount: lane.instanceIds.size,
    renders: lane.count,
    wasted: lane.wastedCount,
    selfTotal: lane.selfTotal,
    depth: lane.maxRow + 1,
    quiet: lane.totalDuration < QUIET_TOTAL_MS,
  }));

  const statsInclude =
    q.includeLane || q.laneFilter
      ? (laneKey: string, name: string) => {
          if (q.includeLane && !q.includeLane(laneKey, name)) return false;
          return laneFilterPasses(compiledFilter, laneKey);
        }
      : undefined;
  const emptyStats = { renders: 0, wasted: 0, selfMs: 0 };
  const stats =
    q.includeStats === false
      ? emptyStats
      : statsInRange(index, t0, t1, { includeLane: statsInclude });
  const quietSummary: TimelineQuietSummary = hasLaneFilter
    ? (() => {
        let lanes = 0;
        let renders = 0;
        let selfMs = 0;
        for (const lane of index.orderedLanes()) {
          if (!includePasses(q, lane, compiledFilter)) continue;
          if (lane.totalDuration >= QUIET_TOTAL_MS) continue;
          lanes++;
          renders += lane.count;
          selfMs += lane.selfTotal;
        }
        return { lanes, renders, selfMs };
      })()
    : index.quietSummary(QUIET_TOTAL_MS);
  const activity = q.includeActivity === false ? [] : activityIntervals(index);
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
    const rowIndex = new Uint32Array(count);
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
      totalRows: ordered.length,
      lod: "buckets",
      lodBucketMs: bucketMs,
      columns: null,
      buckets: { count: k, rowIndex, start, end, renderCount, wastedCount, selfTime, maxDuration },
      stats,
      quietSummary,
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

  const rowIndex = new Uint32Array(count);
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
    totalRows: ordered.length,
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
    quietSummary,
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
