/* oxlint-disable react/react-compiler -- imperative canvas/gesture/derivation caches; not Compiler-safe by design */
import { useReducer, useRef } from "react";
import type { TraceStore, CommitSummary } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import { useTraceVersion } from "../useLens.js";
import { derivationCache } from "../traceFresh.js";
import { laneFilterActive, laneVisibility, type LaneFilter, type LaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { lanesFromQueryResult, statsPairFromStore, type Lane } from "./model/lanes.js";
import { chainFor, edgesForCommit, type CausalEdge } from "./model/edges.js";
import { buildAxis, mergeActive, type TimeSpan } from "./model/axis.js";
import { computeLayout } from "./model/rows.js";
import { packIntervals } from "./model/stacking.js";
import type { LaneMode } from "./model/wave.js";
import { nameWidthFor, RULER_H, VIRTUAL_OVERSCAN_ROWS, VIRTUAL_ROW_H } from "./view/metrics.js";
import { wallWindow } from "./model/viewport.js";
import {
  initialTimelineState,
  timelineReducer,
  type TimelineAction,
  type TimelineContext,
} from "./model/reducer.js";

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
  causality: _causality,
  cursor,
  laneFilter,
  fixApplied = false,
}: UseTimelineArgs) {
  const version = useTraceVersion(store, { kind: "global" });

  const caches = useRef({
    commits: derivationCache<CommitSummary[]>(),
    interactions: derivationCache<ReturnType<TraceStore["interactions"]>>(),
    activity: derivationCache<Array<[number, number]>>(),
    active: derivationCache<Array<[number, number]>>(),
    markers: derivationCache<Array<{ t: number; label: string; warn: boolean }>>(),
    arrows: derivationCache<CausalEdge[]>(),
  }).current;

  const commits = caches.commits.read([store, version], () => store.commits());
  const interactions = caches.interactions.read([store, version], () => store.interactions());
  const bounds = store.timeBounds();

  const gapProgRef = useRef(new Map<string, number>());
  const laneModesRef = useRef(new Map<LaneKey, LaneMode>());

  const acts = caches.activity.read([store, version], () => {
    const intervals = commits
      .map(
        (commit) =>
          [commit.timestamp, Math.max(commit.endTimestamp, commit.timestamp + 0.05)] as [number, number],
      )
      .sort((a, b) => a[0] - b[0]);
    if (intervals.length === 0) return [[bounds.t0, Math.max(bounds.t1, bounds.t0 + 0.05)]];
    const merged: Array<[number, number]> = [];
    for (const [start, end] of intervals) {
      const last = merged[merged.length - 1];
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    return merged;
  });

  const active = caches.active.read([store, version], () => {
    const spans: TimeSpan[] = [];
    for (const commit of commits) spans.push({ start: commit.timestamp, end: commit.endTimestamp });
    for (const it of interactions) spans.push({ start: it.start, end: it.end });
    return spans.length > 0
      ? mergeActive(spans)
      : ([[bounds.t0, bounds.t1]] as Array<[number, number]>);
  });

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
    for (const id of state.expandedGaps) {
      if (!gapProgRef.current.has(id)) gapProgRef.current.set(id, 1);
    }
    return buildAxis(acts, gapProgRef.current);
  })();
  ctxRef.current = { bounds, axis: liveAxis };

  const visible = wallWindow(liveAxis, state.view);
  const plotW = Math.max(1, state.width - nameWidthFor(state.width));
  const pxPerMs = plotW / Math.max(1, state.view.a1 - state.view.a0);
  const filterActive = laneFilterActive(laneFilter);
  const serializedLaneFilter = filterActive
    ? {
        solo: [...laneFilter.solo],
        muted: [...laneFilter.muted],
      }
    : undefined;

  const pad = Math.max(50, (visible.end - visible.start) * 0.1);
  const scrollTop = Math.max(0, state.scrollTop);
  const viewportHeight = Math.max(RULER_H + 40, state.viewportHeight);
  const firstRow = Math.floor(Math.max(0, scrollTop - RULER_H) / VIRTUAL_ROW_H);
  const lastRow = Math.ceil(Math.max(0, scrollTop + viewportHeight - RULER_H) / VIRTUAL_ROW_H);
  const rowStart = Math.max(0, firstRow - VIRTUAL_OVERSCAN_ROWS);
  const rowEnd = Math.max(rowStart + 1, lastRow + VIRTUAL_OVERSCAN_ROWS);
  const timelineResult = store.queryTimeline({
    t0: visible.start - pad,
    t1: visible.end + pad,
    rowStart,
    rowEnd,
    pixelWidth: plotW,
    lodEnterPx: Number.POSITIVE_INFINITY,
    includeQuiet: true,
    includeStats: false,
    includeActivity: false,
    ...(serializedLaneFilter ? { laneFilter: serializedLaneFilter } : {}),
  });
  const lanes: Lane[] = lanesFromQueryResult(timelineResult);

  // Visual stack depth is derived from the intervals in this viewport, not the
  // persisted stackRow/depth hints. That guarantees one vertical slot per
  // simultaneously-overlapping event, regardless of cause/type.
  const laneDepth = new Map<string, number>();
  for (const lane of lanes) {
    const packed = packIntervals(
      lane.clips
        .filter((clip) => !clip.aggregate)
        .map((clip) => ({ key: String(clip.renderId), start: clip.t0, end: clip.t1 })),
    );
    laneDepth.set(lane.key, packed.depth);
  }

  const layout = computeLayout(lanes, laneDepth, {
    shelfOpen: true,
    pxPerMs,
    visible: { t0: visible.start, t1: visible.end },
    prevModes: laneModesRef.current,
    quietSummary: { lanes: 0, renders: 0, selfMs: 0 },
    virtual: {
      rowStart,
      totalRows: timelineResult.totalRows,
      rowHeight: VIRTUAL_ROW_H,
      scrollTop,
      viewportHeight,
    },
    isDim: (key) => {
      const v = laneVisibility(laneFilter, key);
      return v === "muted" || v === "unsoloed";
    },
  });
  const nextLaneModes = new Map(laneModesRef.current);
  for (const row of layout.rows) nextLaneModes.set(row.key, row.mode);
  laneModesRef.current = nextLaneModes;

  const arrows = caches.arrows.read([store, version, state.selectedRender], () =>
    state.selectedRender === null
      ? []
      : chainFor(edgesForCommit(store, state.selectedRender), state.selectedRender),
  );

  const statsRange = state.region ?? { start: visible.start, end: visible.end };
  const statsPair = statsPairFromStore(store, statsRange.start, statsRange.end, {
    ...(serializedLaneFilter ? { laneFilter: serializedLaneFilter } : {}),
  });
  const statsRaw = statsPair.raw;
  const stats = fixApplied ? statsPair.excludeWasted : statsRaw;
  const playhead = cursor.mode === "live" ? bounds.t1 : cursor.t;

  const markers = caches.markers.read([store, version], () => {
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
  });

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
    timelineResult,
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
