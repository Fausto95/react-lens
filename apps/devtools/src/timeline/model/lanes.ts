import type { TraceStore } from "@reactlens/trace-engine";
import {
  RenderFlags,
  causeCodeToName,
  type HitTestResult,
  type TimelineIndex,
  type TimelineQueryResult,
} from "@reactlens/trace-engine";
import type { ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import { typeLaneKey, type LaneKey } from "../../laneFilter.js";

/**
 * Timeline lanes: one per component type. Clips are adapters over the columnar
 * TimelineIndex — the live projection is typed arrays, not Clip objects.
 */

export type ClipCause = "props" | "state" | "context" | "cascade" | "mount" | "other";
export type ClipCauseColor = "props" | "state" | "context" | "cascade";

export function clipCauseColor(cause: ClipCause): ClipCauseColor {
  switch (cause) {
    case "props":
      return "props";
    case "state":
    case "mount":
      return "state";
    case "context":
      return "context";
    default:
      return "cascade";
  }
}

export interface Clip {
  renderId: RenderId;
  componentId: ComponentId;
  laneKey: LaneKey;
  name: string;
  /** Inclusive span start (render timestamp). */
  t0: number;
  /** Inclusive span end — `t0 + totalDuration` so parents cover their subtree. */
  t1: number;
  /** Exclusive self time (ms) — attribution / stats, not bar width. */
  self: number;
  /** Inclusive subtree time (ms) — drives bar width. */
  total: number;
  cause: ClipCause;
  wasted: boolean;
  /** Stack row within the lane (0-based). */
  row: number;
  /** Synthetic mark from a LOD bucket, not a selectable render. */
  aggregate?: boolean;
  renderCount?: number;
  wastedCount?: number;
}

export interface Lane {
  key: LaneKey;
  name: string;
  instanceCount: number;
  clips: Clip[];
  /** Ordered row index from the engine query after filtering/shelf rules. */
  rowIndex?: number;
  renders: number;
  wasted: number;
  selfTotal: number;
  firstT: number;
  /** Max stack depth from incremental assignment. */
  depth?: number;
  lod?: "raw" | "buckets";
  quiet?: boolean;
}

export interface BuildLanesOptions {
  window?: { t0: number; t1: number };
  include?: (laneKey: LaneKey, name: string) => boolean;
  isWasted?: (renderId: RenderId) => boolean;
}

export const MIN_CLIP_MS = 0.05;

function emptyLaneFromRow(
  row: TimelineQueryResult["rows"][number],
  lod: TimelineQueryResult["lod"],
): Lane {
  return {
    key: row.laneKey as LaneKey,
    name: row.name,
    instanceCount: row.instanceCount,
    clips: [],
    rowIndex: row.yIndex,
    renders: row.renders,
    wasted: row.wasted,
    selfTotal: row.selfTotal,
    firstT: row.firstT,
    depth: row.depth,
    lod,
    quiet: row.quiet,
  };
}

/**
 * Build legacy Lane adapters from a viewport query. The expensive part of the
 * pipeline has already happened in typed arrays; this materializes at most the
 * query cap (~10k marks), not one object per session render.
 */
export function lanesFromQueryResult(result: TimelineQueryResult): Lane[] {
  const lanes = result.rows.map((row) => emptyLaneFromRow(row, result.lod));

  if (result.lod === "raw" && result.columns) {
    const cols = result.columns;
    for (let i = 0; i < cols.count; i++) {
      const lane = lanes[cols.rowIndex[i]!];
      if (!lane) continue;
      const t0 = cols.x0[i]!;
      const t1 = cols.x1[i]!;
      lane.clips.push({
        renderId: cols.renderId[i]! as RenderId,
        componentId: cols.componentId[i]! as ComponentId,
        laneKey: lane.key,
        name: lane.name,
        t0,
        t1,
        self: cols.self[i]!,
        total: t1 - t0,
        cause: causeCodeToName(cols.cause[i]!),
        wasted: (cols.flags[i]! & RenderFlags.Wasted) !== 0,
        row: cols.stackRow[i]!,
      });
    }
    return lanes;
  }

  if (result.lod === "buckets" && result.buckets) {
    const buckets = result.buckets;
    for (let i = 0; i < buckets.count; i++) {
      const lane = lanes[buckets.rowIndex[i]!];
      if (!lane) continue;
      const renderCount = buckets.renderCount[i]!;
      const wastedCount = buckets.wastedCount[i]!;
      const t0 = buckets.start[i]!;
      const t1 = buckets.end[i]!;
      lane.clips.push({
        renderId: 0 as RenderId,
        componentId: 0 as ComponentId,
        laneKey: lane.key,
        name: lane.name,
        t0,
        t1,
        self: Math.max(buckets.selfTime[i]!, MIN_CLIP_MS),
        total: Math.max(t1 - t0, buckets.maxDuration[i]!, MIN_CLIP_MS),
        cause: "other",
        wasted: wastedCount > renderCount / 2,
        row: 0,
        aggregate: true,
        renderCount,
        wastedCount,
      });
    }
  }

  return lanes;
}

export function causeOf(render: RenderEvent): ClipCause {
  const reason = render.reasons[0];
  if (!reason) return "other";
  switch (reason.type) {
    case "props":
      return "props";
    case "state":
      return "state";
    case "context":
      return "context";
    case "parent":
      return "cascade";
    case "mount":
      return "mount";
    default:
      return "other";
  }
}

/**
 * Materialize Lane[] adapters from the columnar index.
 * Prefer `window` so cost scales with the viewport, not the session.
 */
export function lanesFromIndex(index: TimelineIndex, options: BuildLanesOptions = {}): Lane[] {
  const { window: win, include } = options;
  const lanes: Lane[] = [];

  for (const col of index.orderedLanes()) {
    if (include && !include(col.laneKey as LaneKey, col.name)) continue;

    let lo = 0;
    let hi = col.count;
    if (win) {
      // binary search via timestamps
      let a = 0;
      let b = col.count;
      while (a < b) {
        const mid = (a + b) >>> 1;
        if (col.timestamps[mid]! < win.t0) a = mid + 1;
        else b = mid;
      }
      lo = a;
      while (lo > 0) {
        const pt0 = col.timestamps[lo - 1]!;
        if (pt0 + col.durations[lo - 1]! < win.t0) break;
        lo--;
      }
      a = lo;
      b = col.count;
      while (a < b) {
        const mid = (a + b) >>> 1;
        if (col.timestamps[mid]! <= win.t1) a = mid + 1;
        else b = mid;
      }
      hi = a;
    }

    const clips: Clip[] = [];
    for (let i = lo; i < hi; i++) {
      const t0 = col.timestamps[i]!;
      const total = col.durations[i]!;
      clips.push({
        renderId: col.renderIds[i]! as RenderId,
        componentId: col.componentIds[i]! as ComponentId,
        laneKey: col.laneKey as LaneKey,
        name: col.name,
        t0,
        t1: t0 + total,
        self: col.selfDurations[i]!,
        total,
        cause: causeCodeToName(col.causes[i]!),
        wasted: (col.flags[i]! & RenderFlags.Wasted) !== 0,
        row: col.rows[i]!,
      });
    }

    lanes.push({
      key: col.laneKey as LaneKey,
      name: col.name,
      instanceCount: col.instanceIds.size,
      clips,
      renders: col.count,
      wasted: col.wastedCount,
      selfTotal: col.selfTotal,
      firstT: Number.isFinite(col.firstT) ? col.firstT : 0,
      depth: col.maxRow + 1,
    });
  }

  return lanes;
}

/** @deprecated Prefer lanesFromIndex — still used by tests. */
export function buildLanes(store: TraceStore, options: BuildLanesOptions = {}): Lane[] {
  if (store.timelineIndex.count > 0) {
    return lanesFromIndex(store.timelineIndex, options);
  }
  // Fallback for empty index / legacy fixtures that never went through ingest hooks.
  const { window: win, include, isWasted } = options;
  type Draft = {
    key: LaneKey;
    name: string;
    clips: Clip[];
    instances: Set<ComponentId>;
  };
  const drafts = new Map<LaneKey, Draft>();

  for (const instance of store.allInstances()) {
    const key = typeLaneKey(instance.name);
    if (include && !include(key, instance.name)) continue;
    for (const render of store.rendersOf(instance.id)) {
      const t0 = render.timestamp;
      const total = Math.max(render.totalDuration, render.selfDuration, MIN_CLIP_MS);
      const t1 = t0 + total;
      if (win && (t1 < win.t0 || t0 > win.t1)) continue;
      let draft = drafts.get(key);
      if (!draft) {
        draft = { key, name: instance.name, clips: [], instances: new Set() };
        drafts.set(key, draft);
      }
      draft.instances.add(instance.id);
      draft.clips.push({
        renderId: render.renderId,
        componentId: instance.id,
        laneKey: key,
        name: instance.name,
        t0,
        t1,
        self: render.selfDuration,
        total,
        cause: causeOf(render),
        wasted: isWasted ? isWasted(render.renderId) : false,
        row: 0,
      });
    }
  }

  const lanes: Lane[] = [];
  for (const draft of drafts.values()) {
    draft.clips.sort((a, b) => a.t0 - b.t0);
    lanes.push({
      key: draft.key,
      name: draft.name,
      instanceCount: draft.instances.size,
      clips: draft.clips,
      renders: draft.clips.length,
      wasted: draft.clips.reduce((n, c) => n + (c.wasted ? 1 : 0), 0),
      selfTotal: draft.clips.reduce((n, c) => n + c.self, 0),
      firstT: draft.clips[0]?.t0 ?? 0,
    });
  }

  lanes.sort((a, b) => a.firstT - b.firstT || a.name.localeCompare(b.name));
  return lanes;
}

export interface RegionStats {
  renders: number;
  wasted: number;
  selfMs: number;
  byLane: Map<LaneKey, { renders: number; wasted: number; selfMs: number }>;
  byComponent: Map<ComponentId, { renders: number; wasted: number; selfMs: number }>;
}

export function statsInRegion(
  lanes: Lane[],
  t0: number,
  t1: number,
  options: { excludeWasted?: boolean } = {},
): RegionStats {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const excludeWasted = options.excludeWasted === true;
  const byLane = new Map<LaneKey, { renders: number; wasted: number; selfMs: number }>();
  const byComponent = new Map<ComponentId, { renders: number; wasted: number; selfMs: number }>();
  let renders = 0;
  let wasted = 0;
  let selfMs = 0;
  for (const lane of lanes) {
    let laneRenders = 0;
    let laneWasted = 0;
    let laneSelf = 0;
    for (const clip of lane.clips) {
      if (clip.t1 < lo || clip.t0 > hi) continue;
      if (excludeWasted && clip.wasted) continue;
      laneRenders++;
      if (clip.wasted) laneWasted++;
      laneSelf += clip.self;

      const own = byComponent.get(clip.componentId) ?? { renders: 0, wasted: 0, selfMs: 0 };
      own.renders++;
      if (clip.wasted && !excludeWasted) own.wasted++;
      own.selfMs += clip.self;
      byComponent.set(clip.componentId, own);
    }
    if (laneRenders === 0) continue;
    byLane.set(lane.key, {
      renders: laneRenders,
      wasted: excludeWasted ? 0 : laneWasted,
      selfMs: laneSelf,
    });
    renders += laneRenders;
    wasted += excludeWasted ? 0 : laneWasted;
    selfMs += laneSelf;
  }
  return { renders, wasted, selfMs, byLane, byComponent };
}

/** Prefix-sum stats from the store's columnar index. */
export function statsFromStore(
  store: TraceStore,
  t0: number,
  t1: number,
  options: {
    includeLane?: (laneKey: LaneKey, name: string) => boolean;
    excludeWasted?: boolean;
  } = {},
): Omit<RegionStats, "byLane" | "byComponent"> & {
  byLane: Map<LaneKey, { renders: number; wasted: number; selfMs: number }>;
  byComponent: Map<ComponentId, { renders: number; wasted: number; selfMs: number }>;
} {
  const s = store.statsInRange(t0, t1, {
    includeLane: options.includeLane,
    excludeWasted: options.excludeWasted,
  });
  return {
    renders: s.renders,
    wasted: s.wasted,
    selfMs: s.selfMs,
    byLane: new Map(),
    byComponent: new Map(),
  };
}

function hitToClip(hit: HitTestResult): Clip {
  return {
    renderId: hit.renderId as RenderId,
    componentId: hit.componentId as ComponentId,
    laneKey: hit.laneKey as LaneKey,
    name: hit.laneKey.replace(/^t:/, ""),
    t0: hit.t0,
    t1: hit.t1,
    self: hit.self,
    total: hit.t1 - hit.t0,
    cause: causeCodeToName(hit.cause),
    wasted: hit.wasted,
    row: hit.stackRow,
  };
}

export function clipAtTime(
  lanes: Lane[],
  t: number,
  preferLane: LaneKey | null = null,
): Clip | null {
  let best: Clip | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    // Binary search within the lane's (already-sorted) clips.
    const clips = lane.clips;
    let lo = 0;
    let hi = clips.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (clips[mid]!.t0 < t) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 4);
    const end = Math.min(clips.length, lo + 8);
    for (let i = start; i < end; i++) {
      const clip = clips[i]!;
      if (clip.aggregate) continue;
      const containing = clip.t0 <= t && t <= clip.t1;
      const mid = (clip.t0 + clip.t1) / 2;
      let score = Math.abs(mid - t);
      if (containing) score *= 0.05;
      if (preferLane && clip.laneKey === preferLane) score *= 0.25;
      if (!containing && Math.abs(mid - t) > Math.max(clip.t1 - clip.t0, 80) * 4) continue;
      if (score < bestScore) {
        bestScore = score;
        best = clip;
      }
    }
  }
  return best;
}

/** O(log N) hit test against the columnar index. */
export function clipAtTimeFromStore(
  store: TraceStore,
  t: number,
  preferLane: LaneKey | null = null,
): Clip | null {
  const hit = store.hitTest(t, preferLane);
  return hit ? hitToClip(hit) : null;
}
