"use no memo";

// The Compiler is off for this file deliberately.
//
// `useTraceVersion` returns a counter used purely to bust caches: the trace
// store mutates in place, so its identity never changes and only the version
// says the data moved on. The memos below therefore list `version` as a
// dependency without reading it. The Compiler infers dependencies from actual
// reads, so it would drop `version`, cache on the store's stable identity and
// never recompute — the panel would freeze on its first frame.
//
// Everything that does not read the store this way is compiled normally.

import { useMemo, useReducer, useRef } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { useTraceVersion } from "../useLens.js";
import { isLaneVisible, type LaneFilter } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { buildLanes, statsInRegion } from "./model/lanes.js";
import { chainFor, edgesForCommit } from "./model/edges.js";
import { laneRows, lanesContaining, rowsHeight } from "./model/rows.js";
import { mergeActive, projectT, projectX, type TimeSpan } from "./model/scale.js";
import { replaySchedule, replaySpan, type Sweep } from "./model/schedule.js";
import {
  initialTimelineState,
  timelineReducer,
  type TimelineAction,
  type TimelineContext,
  type TimelineState,
} from "./model/reducer.js";
import { viewportScale, windowOf } from "./model/viewport.js";

/** Verdicts walk causality per render, so the sweep is capped. */
const WHY_CAP = 400;
/** A commit over ~3 frames earns a marker on the ruler. */
export const LONG_TASK_MS = 50;

export interface UseTimelineArgs {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  laneFilter: LaneFilter;
  /** "Replay with fix" — wasted renders drop out of the region totals. */
  fixApplied?: boolean;
}

/**
 * Binds the pure timeline model to the store and the shared time cursor.
 *
 * Everything returned is *derived*. The only stored state is the reducer's,
 * and the cursor — which belongs to the panel, because the tree and inspector
 * read it too. Nothing here copies one piece of state into another.
 */
export function useTimeline({
  store,
  causality,
  cursor,
  laneFilter,
  fixApplied = false,
}: UseTimelineArgs) {
  const version = useTraceVersion(store, { kind: "global" });

  const commits = useMemo(() => store.commits(), [store, version]);
  const interactions = useMemo(() => store.interactions(), [store, version]);

  /** Session extent across renders AND commits, with a floor so a mount-only
   *  session cannot collapse to a zero-width scale. */
  const bounds = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const instance of store.allInstances()) {
      for (const render of store.rendersOf(instance.id)) {
        lo = Math.min(lo, render.timestamp);
        hi = Math.max(hi, render.timestamp + Math.max(render.selfDuration, 0));
      }
    }
    for (const commit of commits) {
      lo = Math.min(lo, commit.timestamp);
      hi = Math.max(hi, commit.endTimestamp);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { t0: 0, t1: 120 };
    return { t0: lo, t1: Math.max(hi, lo + 120) };
  }, [store, commits, version]);

  /** Active spans drive idle compression: gaps between them become gutters. */
  const active = useMemo(() => {
    const spans: TimeSpan[] = [];
    for (const commit of commits) spans.push({ start: commit.timestamp, end: commit.endTimestamp });
    for (const it of interactions) spans.push({ start: it.start, end: it.end });
    return spans.length > 0 ? mergeActive(spans) : [[bounds.t0, bounds.t1] as [number, number]];
  }, [commits, interactions, bounds]);

  const ctx: TimelineContext = useMemo(() => ({ bounds, active }), [bounds, active]);
  // The reducer stays pure (state, action, ctx); React only supplies two args,
  // so the live context is read through a ref at dispatch time.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const [state, dispatch] = useReducer(
    (s: TimelineState, a: TimelineAction) => timelineReducer(s, a, ctxRef.current),
    undefined,
    () => initialTimelineState(),
  );

  // ── Derived geometry ──────────────────────────────────────────────────────
  const scale = useMemo(
    () => viewportScale(state.viewport, bounds, active),
    [state.viewport, bounds, active],
  );
  const visible = useMemo(
    () => windowOf(scale, state.viewport.scrollLeft, state.viewport.width),
    [scale, state.viewport.scrollLeft, state.viewport.width],
  );
  const idleSegs = useMemo(() => scale.segs.filter((seg) => seg.idle), [scale]);

  // ── Derived lanes ─────────────────────────────────────────────────────────
  const wasted = useMemo(() => {
    const set = new Set<RenderId>();
    let checked = 0;
    for (const instance of store.allInstances()) {
      for (const render of store.rendersOf(instance.id)) {
        if (checked >= WHY_CAP) return set;
        checked++;
        try {
          if (causality.why(render.renderId).verdict === "no-observable-change") {
            set.add(render.renderId);
          }
        } catch {
          /* a render without snapshots simply has no verdict */
        }
      }
    }
    return set;
  }, [store, causality, version]);

  const lanes = useMemo(
    () =>
      buildLanes(store, {
        include: (key) => isLaneVisible(laneFilter, key),
        isWasted: (renderId) => wasted.has(renderId),
      }),
    [store, version, laneFilter, wasted],
  );
  const rows = useMemo(() => laneRows(lanes, state.expandedLanes), [lanes, state.expandedLanes]);
  const canvasHeight = useMemo(() => rowsHeight(rows), [rows]);

  // ── Derived causality ─────────────────────────────────────────────────────
  const arrows = useMemo(() => {
    if (state.selectedRender === null) return [];
    return chainFor(edgesForCommit(store, state.selectedRender), state.selectedRender);
  }, [store, state.selectedRender, version]);

  /** Lanes the selected cascade reaches — revealing them gives arrows a target. */
  const lanesToReveal = useMemo(() => {
    if (arrows.length === 0) return [];
    const touched = new Set<ComponentId>();
    for (const edge of arrows) {
      for (const id of [edge.from, edge.to]) {
        const componentId = store.getRender(id)?.componentId;
        if (componentId !== undefined) touched.add(componentId);
      }
    }
    return lanesContaining(lanes, touched);
  }, [arrows, lanes, store]);

  // ── Derived stats + replay ────────────────────────────────────────────────
  /** Region when the user set one, otherwise whatever is on screen. */
  const statsRange = state.region ?? { start: visible.start, end: visible.end };
  const stats = useMemo(
    () => statsInRegion(lanes, statsRange.start, statsRange.end, { excludeWasted: fixApplied }),
    [lanes, statsRange.start, statsRange.end, fixApplied],
  );
  /** Same range including waste — the baseline for the "−N renders" fix note. */
  const statsRaw = useMemo(
    () => statsInRegion(lanes, statsRange.start, statsRange.end),
    [lanes, statsRange.start, statsRange.end],
  );
  const schedule = useMemo(
    () => replaySchedule(commits, state.region, bounds, state.playFrom),
    [commits, state.region, bounds, state.playFrom],
  );
  /** Full span of what ▶ would replay, ignoring where it was started from. */
  const replayRange = useMemo(() => replaySpan(state.region, bounds), [state.region, bounds]);
  /**
   * How much of that range is left to play, measured *on screen*. Starting
   * from the playhead would otherwise take a full replay's worth of time
   * however little remained, so a late start crawled.
   */
  const replayFraction = useMemo(() => {
    const from = replaySpan(state.region, bounds, state.playFrom).lo;
    const x0 = projectX(scale.segs, replayRange.lo);
    const x1 = projectX(scale.segs, replayRange.hi);
    if (x1 - x0 <= 0) return 1;
    return Math.max(0, Math.min(1, (x1 - projectX(scale.segs, from)) / (x1 - x0)));
  }, [scale, state.region, state.playFrom, bounds, replayRange]);
  /**
   * The playhead advances at a constant speed *on screen*, not on the clock:
   * compressed idle gutters are 34 px wide however long they lasted, and a
   * wall-clock sweep would stall inside them for most of the replay.
   */
  const sweep = useMemo<Sweep>(() => {
    const { lo, hi } = replaySpan(state.region, bounds, state.playFrom);
    const x0 = projectX(scale.segs, lo);
    const x1 = projectX(scale.segs, hi);
    return (p) => projectT(scale.segs, x0 + (x1 - x0) * Math.max(0, Math.min(1, p)));
  }, [scale, state.region, bounds, state.playFrom]);

  const playhead = cursor.mode === "live" ? bounds.t1 : cursor.t;

  return {
    state,
    dispatch,
    bounds,
    active,
    commits,
    interactions,
    scale,
    visible,
    idleSegs,
    lanes,
    rows,
    canvasHeight,
    arrows,
    lanesToReveal,
    stats,
    statsRaw,
    fixSavedRenders: Math.max(0, statsRaw.renders - stats.renders),
    schedule,
    replayRange,
    replayFraction,
    sweep,
    playhead,
  };
}

export type Timeline = ReturnType<typeof useTimeline>;
