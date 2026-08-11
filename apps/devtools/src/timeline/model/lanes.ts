import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import { instanceLaneKey, typeLaneKey, type LaneKey } from "../../laneFilter.js";

/**
 * Timeline lanes: one per **component type**, expandable to per-instance
 * sub-lanes. Renders are clips on a real time axis — width is duration, color
 * is the cause — so a cascade reads as a vertical waterfall down the lanes.
 *
 * Pure: plain trace data in, plain layout data out. No React, no px. The view
 * maps time→x; this module never sees the scale.
 */

/**
 * Why a render happened. Kept finer-grained than the palette because the
 * inspector says "mount" rather than "state" — see `clipCauseClass` for the
 * mapping onto the four colors the legend advertises.
 */
export type ClipCause = "props" | "state" | "context" | "cascade" | "mount" | "other";

/** The four legend colors: props (blue) · state (green) · context (purple) · cascade (gray). */
export type ClipCauseColor = "props" | "state" | "context" | "cascade";

/**
 * Collapse a cause onto the legend's four colors.
 *
 * A mount is the component's own first render, so it reads as own-work
 * (green) rather than parent-driven; anything we can't attribute falls back
 * to cascade gray. Without this, `mount`/`other` clips matched no color rule
 * at all and rendered as invisible boxes.
 */
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
  /** Owning type lane — clips keep it so hit-testing needn't walk lanes. */
  laneKey: LaneKey;
  name: string;
  t0: number;
  t1: number;
  self: number;
  cause: ClipCause;
  /** Rendered, but produced no observable DOM change. */
  wasted: boolean;
}

export interface SubLane {
  key: LaneKey;
  componentId: ComponentId;
  /** `#12` — the instance's identity within its type. */
  label: string;
  clips: Clip[];
}

export interface Lane {
  key: LaneKey;
  name: string;
  /** Distinct instances seen. 1 = type and instance are the same thing. */
  instanceCount: number;
  /** Every clip of the type, ordered by time. */
  clips: Clip[];
  /** Per-instance lanes, only meaningful when `instanceCount > 1`. */
  subs: SubLane[];
  renders: number;
  wasted: number;
  selfTotal: number;
  /** Earliest activity — lanes sort by it so cascades descend. */
  firstT: number;
  /** Occupancy buckets for the collapsed density strip. */
  density: DensityBucket[];
}

export interface DensityBucket {
  t0: number;
  t1: number;
  count: number;
  wasted: number;
}

export interface BuildLanesOptions {
  /** Visible time window; clips outside are dropped before layout. */
  window?: { t0: number; t1: number };
  /** Solo / mute. Excluded lanes never reach the view. */
  include?: (laneKey: LaneKey, name: string) => boolean;
  /** Wasted-render verdict, capped and memoized by the caller. */
  isWasted?: (renderId: RenderId) => boolean;
  /** Buckets in the density strip (default 48). */
  densityBuckets?: number;
  /** A type needs at least this many instances to offer expansion. */
  expandThreshold?: number;
}

/** Sub-millisecond renders still need a clickable clip. */
export const MIN_CLIP_MS = 0.05;
const DEFAULT_BUCKETS = 48;

export function causeOf(render: RenderEvent): ClipCause {
  // First reason wins: the instrumentation already orders them by specificity
  // (a state update that also changed props is a state render).
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

export function buildLanes(store: TraceStore, options: BuildLanesOptions = {}): Lane[] {
  const {
    window: win,
    include,
    isWasted,
    densityBuckets = DEFAULT_BUCKETS,
    expandThreshold = 2,
  } = options;

  type Draft = {
    key: LaneKey;
    name: string;
    clips: Clip[];
    byInstance: Map<ComponentId, Clip[]>;
  };
  const drafts = new Map<LaneKey, Draft>();

  for (const instance of store.allInstances()) {
    const key = typeLaneKey(instance.name);
    if (include && !include(key, instance.name)) continue;
    for (const render of store.rendersOf(instance.id)) {
      const t0 = render.timestamp;
      const t1 = t0 + Math.max(render.selfDuration, MIN_CLIP_MS);
      if (win && (t1 < win.t0 || t0 > win.t1)) continue;
      let draft = drafts.get(key);
      if (!draft) {
        draft = { key, name: instance.name, clips: [], byInstance: new Map() };
        drafts.set(key, draft);
      }
      const clip: Clip = {
        renderId: render.renderId,
        componentId: instance.id,
        laneKey: key,
        name: instance.name,
        t0,
        t1,
        self: render.selfDuration,
        cause: causeOf(render),
        wasted: isWasted ? isWasted(render.renderId) : false,
      };
      draft.clips.push(clip);
      const list = draft.byInstance.get(instance.id);
      if (list) list.push(clip);
      else draft.byInstance.set(instance.id, [clip]);
    }
  }

  const lanes: Lane[] = [];
  for (const draft of drafts.values()) {
    draft.clips.sort((a, b) => a.t0 - b.t0);
    const instanceCount = draft.byInstance.size;
    // A single-instance type has no instance/type distinction to expand into —
    // showing a chevron there would promise a level that doesn't exist.
    const subs: SubLane[] =
      instanceCount >= expandThreshold
        ? [...draft.byInstance.entries()]
            .map(([componentId, clips]) => ({
              key: instanceLaneKey(draft.name, componentId),
              componentId,
              label: `#${String(componentId)}`,
              clips: [...clips].sort((a, b) => a.t0 - b.t0),
            }))
            .sort((a, b) => (a.clips[0]?.t0 ?? 0) - (b.clips[0]?.t0 ?? 0))
        : [];

    lanes.push({
      key: draft.key,
      name: draft.name,
      instanceCount,
      clips: draft.clips,
      subs,
      renders: draft.clips.length,
      wasted: draft.clips.reduce((n, c) => n + (c.wasted ? 1 : 0), 0),
      selfTotal: draft.clips.reduce((n, c) => n + c.self, 0),
      firstT: draft.clips[0]?.t0 ?? 0,
      density: buildDensity(draft.clips, densityBuckets, win),
    });
  }

  // Earliest-first so a cascade reads top-to-bottom, origin at the top.
  lanes.sort((a, b) => a.firstT - b.firstT || a.name.localeCompare(b.name));
  return lanes;
}

/**
 * Occupancy histogram for the collapsed group strip: `ListItem ×200` becomes a
 * heat band instead of 200 unreadable slivers.
 */
export function buildDensity(
  clips: Clip[],
  buckets: number,
  win?: { t0: number; t1: number },
): DensityBucket[] {
  if (clips.length === 0 || buckets <= 0) return [];
  const t0 = win?.t0 ?? clips[0]!.t0;
  const t1 = win?.t1 ?? clips.reduce((m, c) => Math.max(m, c.t1), t0);
  const span = t1 - t0;
  if (span <= 0) return [];
  const width = span / buckets;
  const out: DensityBucket[] = Array.from({ length: buckets }, (_, i) => ({
    t0: t0 + i * width,
    t1: t0 + (i + 1) * width,
    count: 0,
    wasted: 0,
  }));
  for (const clip of clips) {
    // A clip spans every bucket it overlaps, so long renders read as wide heat.
    const first = Math.max(0, Math.floor((clip.t0 - t0) / width));
    const last = Math.min(buckets - 1, Math.floor((clip.t1 - t0) / width));
    for (let i = first; i <= last; i++) {
      const bucket = out[i];
      if (!bucket) continue;
      bucket.count++;
      if (clip.wasted) bucket.wasted++;
    }
  }
  return out;
}

/** Peak bucket — the denominator for normalizing strip intensity. */
export function densityPeak(lanes: Lane[]): number {
  let peak = 0;
  for (const lane of lanes) {
    for (const bucket of lane.density) peak = Math.max(peak, bucket.count);
  }
  return peak;
}

/** Region-scoped totals for the timeline footer and the tree's heat. */
export interface RegionStats {
  renders: number;
  wasted: number;
  selfMs: number;
  /** Renders per component type inside the region — drives tree heat. */
  byLane: Map<LaneKey, { renders: number; wasted: number; selfMs: number }>;
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
  let renders = 0;
  let wasted = 0;
  let selfMs = 0;
  for (const lane of lanes) {
    let laneRenders = 0;
    let laneWasted = 0;
    let laneSelf = 0;
    for (const clip of lane.clips) {
      // Overlap, not containment: a render straddling the edge still counts.
      if (clip.t1 < lo || clip.t0 > hi) continue;
      if (excludeWasted && clip.wasted) continue;
      laneRenders++;
      if (clip.wasted) laneWasted++;
      laneSelf += clip.self;
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
  return { renders, wasted, selfMs, byLane };
}

/**
 * Pick the clip the playhead is "on" so scrubbing can drive the inspector.
 *
 * Prefer a clip that contains `t`, then the preferred lane, then nearest midpoint.
 */
export function clipAtTime(
  lanes: Lane[],
  t: number,
  preferLane: LaneKey | null = null,
): Clip | null {
  let best: Clip | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const lane of lanes) {
    for (const clip of lane.clips) {
      const containing = clip.t0 <= t && t <= clip.t1;
      const mid = (clip.t0 + clip.t1) / 2;
      let score = Math.abs(mid - t);
      if (containing) score *= 0.05;
      if (preferLane && clip.laneKey === preferLane) score *= 0.25;
      // Ignore clips that are far outside the playhead — otherwise a lone
      // early mount would steal the inspector for the whole session.
      if (!containing && Math.abs(mid - t) > Math.max(clip.t1 - clip.t0, 80) * 4) continue;
      if (score < bestScore) {
        bestScore = score;
        best = clip;
      }
    }
  }
  return best;
}
