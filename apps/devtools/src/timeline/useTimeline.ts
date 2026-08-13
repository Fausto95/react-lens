import { useReducer, useRef } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { RenderId } from "@reactlens/protocol";
import { useTraceVersion } from "../useLens.js";
import { useDerived } from "../useDerived.js";
import { isLaneVisible, laneVisibility, type LaneFilter } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { buildLanes, statsInRegion } from "./model/lanes.js";
import { chainFor, edgesForCommit } from "./model/edges.js";
import { buildActivity, buildAxis, mergeActive, type TimeSpan } from "./model/axis.js";
import { computeLayout } from "./model/rows.js";
import { assignStacks } from "./model/stacks.js";
import { wallWindow } from "./model/viewport.js";
import {
  initialTimelineState,
  timelineReducer,
  type TimelineAction,
  type TimelineContext,
} from "./model/reducer.js";

const WHY_CAP = 400;
export const LONG_TASK_MS = 50;

export interface UseTimelineArgs {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  laneFilter: LaneFilter;
  fixApplied?: boolean;
}

export function useTimeline({
  store,
  causality,
  cursor,
  laneFilter,
  fixApplied = false,
}: UseTimelineArgs) {
  const version = useTraceVersion(store, { kind: "global" });

  const commits = useDerived([store, version], () => store.commits());
  const interactions = useDerived([store, version], () => store.interactions());

  const bounds = useDerived([store, version, commits], () => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const instance of store.allInstances()) {
      for (const render of store.rendersOf(instance.id)) {
        lo = Math.min(lo, render.timestamp);
        hi = Math.max(
          hi,
          render.timestamp + Math.max(render.totalDuration, render.selfDuration, 0),
        );
      }
    }
    for (const commit of commits) {
      lo = Math.min(lo, commit.timestamp);
      hi = Math.max(hi, commit.endTimestamp);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { t0: 0, t1: 120 };
    return { t0: lo, t1: Math.max(hi, lo + 120) };
  });

  const wasted = useDerived([store, causality, version], () => {
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
          /* no verdict */
        }
      }
    }
    return set;
  });

  const lanes = useDerived([store, version, laneFilter, wasted], () =>
    buildLanes(store, {
      include: (key) => isLaneVisible(laneFilter, key),
      isWasted: (renderId) => wasted.has(renderId),
    }),
  );

  const laneDepth = (() => {
    const byLane = new Map<string, (typeof lanes)[0]["clips"]>();
    for (const lane of lanes) byLane.set(lane.key, lane.clips);
    return assignStacks(byLane);
  })();

  const acts = (() => {
    const iv: Array<[number, number]> = [];
    for (const lane of lanes) {
      for (const c of lane.clips) iv.push([c.t0, c.t1]);
    }
    for (const c of commits) iv.push([c.timestamp, c.endTimestamp]);
    for (const it of interactions) iv.push([it.start, it.end]);
    if (iv.length === 0) iv.push([bounds.t0, bounds.t1]);
    return buildActivity(iv);
  })();

  const active = (() => {
    const spans: TimeSpan[] = [];
    for (const commit of commits) spans.push({ start: commit.timestamp, end: commit.endTimestamp });
    for (const it of interactions) spans.push({ start: it.start, end: it.end });
    return spans.length > 0
      ? mergeActive(spans)
      : ([[bounds.t0, bounds.t1]] as Array<[number, number]>);
  })();

  const gapProgRef = useRef(new Map<string, number>());
  const ctxRef = useRef<TimelineContext>({
    bounds,
    axis: buildAxis(acts, gapProgRef.current),
  });
  const [state, dispatch] = useReducer(
    (s: Parameters<typeof timelineReducer>[0], a: TimelineAction) =>
      timelineReducer(s, a, ctxRef.current),
    undefined,
    () => {
      const ax = buildAxis(acts, gapProgRef.current);
      return initialTimelineState({ view: { a0: 0, a1: ax.total } });
    },
  );

  const liveAxis = (() => {
    // Remount / first paint: expanded gaps should already be at full progress.
    for (const id of state.expandedGaps) {
      if (!gapProgRef.current.has(id)) gapProgRef.current.set(id, 1);
    }
    return buildAxis(acts, gapProgRef.current);
  })();
  ctxRef.current = { bounds, axis: liveAxis };

  const visible = wallWindow(liveAxis, state.view);

  const plotW = Math.max(1, state.width * 0.86);
  const pxPerMs = plotW / Math.max(1, state.view.a1 - state.view.a0);

  const layout = computeLayout(lanes, laneDepth, {
    shelfOpen: state.shelfOpen,
    pxPerMs,
    isDim: (key) => {
      const v = laneVisibility(laneFilter, key);
      return v === "muted" || v === "unsoloed";
    },
  });

  const arrows = useDerived([store, version, state.selectedRender], () =>
    state.selectedRender === null
      ? []
      : chainFor(edgesForCommit(store, state.selectedRender), state.selectedRender),
  );

  const statsRange = state.region ?? { start: visible.start, end: visible.end };
  const stats = statsInRegion(lanes, statsRange.start, statsRange.end, {
    excludeWasted: fixApplied,
  });
  const statsRaw = statsInRegion(lanes, statsRange.start, statsRange.end);

  const playhead = cursor.mode === "live" ? bounds.t1 : cursor.t;

  const markers = (() => {
    const out: Array<{ t: number; label: string; warn: boolean }> = [];
    for (const it of interactions) {
      out.push({ t: it.start, label: it.label || "interaction", warn: false });
    }
    for (const c of commits) {
      const dur = c.endTimestamp - c.timestamp;
      if (dur >= LONG_TASK_MS) {
        out.push({ t: c.timestamp, label: `long task ${Math.round(dur)} ms`, warn: true });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  })();

  return {
    state,
    dispatch,
    gapProgRef,
    bounds,
    active,
    acts,
    axis: liveAxis,
    commits,
    interactions,
    markers,
    visible,
    lanes,
    laneDepth,
    layout,
    arrows,
    stats,
    statsRaw,
    fixSavedRenders: Math.max(0, statsRaw.renders - stats.renders),
    playhead,
    pxPerMs,
  };
}

export type Timeline = ReturnType<typeof useTimeline>;
