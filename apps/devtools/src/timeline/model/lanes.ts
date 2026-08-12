import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId, RenderEvent, RenderId } from "@reactlens/protocol";
import { typeLaneKey, type LaneKey } from "../../laneFilter.js";

/**
 * Timeline lanes: one per component type. Clips carry duration + cause; stack
 * rows / wave mode are decided later in layout.
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
}

export interface Lane {
  key: LaneKey;
  name: string;
  instanceCount: number;
  clips: Clip[];
  renders: number;
  wasted: number;
  selfTotal: number;
  firstT: number;
}

export interface BuildLanesOptions {
  window?: { t0: number; t1: number };
  include?: (laneKey: LaneKey, name: string) => boolean;
  isWasted?: (renderId: RenderId) => boolean;
}

export const MIN_CLIP_MS = 0.05;

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

export function buildLanes(store: TraceStore, options: BuildLanesOptions = {}): Lane[] {
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
      // Inclusive width: a parent that barely works still spans its cascade, so
      // App doesn't read as a hairline while CartBadge shows 18 ms underneath.
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
      if (!containing && Math.abs(mid - t) > Math.max(clip.t1 - clip.t0, 80) * 4) continue;
      if (score < bestScore) {
        bestScore = score;
        best = clip;
      }
    }
  }
  return best;
}
