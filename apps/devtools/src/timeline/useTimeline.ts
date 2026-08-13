/* oxlint-disable react/react-compiler -- imperative canvas/gesture/derivation caches; not Compiler-safe by design */
import { useReducer, useRef } from "react";
import type { TraceStore, CommitSummary } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import { useTraceVersion } from "../useLens.js";
import { derivationCache } from "../traceFresh.js";
import {
  isLaneVisible,
  laneFilterActive,
  laneVisibility,
  type LaneFilter,
  type LaneKey,
} from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { lanesFromQueryResult, statsFromStore, type Lane } from "./model/lanes.js";
import { chainFor, edgesForCommit, type CausalEdge } from "./model/edges.js";
import { buildActivity, buildAxis, mergeActive, type TimeSpan } from "./model/axis.js";
import { computeLayout } from "./model/rows.js";
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

  // Version-keyed caches: the store mutates in place; pan/zoom re-renders must
  // not redo lane materialization from the full session.
  const caches = useRef({
    commits: derivationCache<CommitSummary[]>(),
    interactions: derivationCache<ReturnType<TraceStore["interactions"]>>(),
    activity: derivationCache<ReturnType<typeof buildActivity>>(),
    active: derivationCache<Array<[number, number]>>(),
    markers: derivationCache<Array<{ t: number; label: string; warn: boolean }>>(),
    arrows: derivationCache<CausalEdge[]>(),
  }).current;

  const commits = caches.commits.read([store, version], () => store.commits());
  const interactions = caches.interactions.read([store, version], () => store.interactions());

  // O(1) running bounds from the columnar index.
  const bounds = store.timeBounds();

  const gapProgRef = useRef(new Map<string, number>());
  const laneModesRef = useRef(new Map<LaneKey, LaneMode>());

  // Activity from LOD summary — not every clip.
  const acts = caches.activity.read([store, version], () => {
    const fromIndex = store.activityIntervals(64);
    const iv: Array<[number, number]> = fromIndex.length > 0 ? [...fromIndex] : [];
    for (const c of commits) iv.push([c.timestamp, c.endTimestamp]);
    for (const it of interactions) iv.push([it.start, it.end]);
    if (iv.length === 0) iv.push([bounds.t0, bounds.t1]);
    return buildActivity(iv);
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

  // Materialize only the visible time window (+ pad) from columnar lanes.
  // Wastedness is a stored flag — no causality.why() sweep.
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
    includeQuiet: state.shelfOpen,
    includeStats: false,
    includeActivity: false,
    ...(filterActive
      ? {
          laneFilter: {
            solo: [...laneFilter.solo],
            muted: [...laneFilter.muted],
          },
        }
      : {}),
  });
  const lanes: Lane[] = lanesFromQueryResult(timelineResult);

  const laneDepth = new Map<string, number>();
  for (const lane of lanes) {
    laneDepth.set(lane.key, Math.max(1, lane.depth ?? 1));
  }

  const layout = computeLayout(lanes, laneDepth, {
    shelfOpen: state.shelfOpen,
    pxPerMs,
    visible: { t0: visible.start, t1: visible.end },
    prevModes: laneModesRef.current,
    quietSummary: timelineResult.quietSummary,
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
  const includeLane = filterActive
    ? (key: string) => isLaneVisible(laneFilter, key as LaneKey)
    : undefined;
  const stats = statsFromStore(store, statsRange.start, statsRange.end, {
    ...(includeLane ? { includeLane } : {}),
    excludeWasted: fixApplied,
  });
  const statsRaw = statsFromStore(store, statsRange.start, statsRange.end, {
    ...(includeLane ? { includeLane } : {}),
  });

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
