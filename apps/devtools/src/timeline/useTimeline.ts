/* oxlint-disable react/react-compiler -- reducer/context refs are intentionally imperative */
import { useReducer, useRef } from "react";
import type { TraceStore, CommitSummary } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import { useTraceVersion } from "../useLens.js";
import { derivationCache } from "../traceFresh.js";
import type { TimeCursor } from "../timeCursor.js";
import { statsPairFromStore } from "./model/lanes.js";
import { buildActivity, buildAxis, mergeActive, type TimeSpan } from "./model/axis.js";
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
  fixApplied?: boolean;
}

/**
 * Shared timeline model for Cascade.
 *
 * The old lane timeline paid for a viewport lane query, stack assignment and
 * wave layout on every relevant state change. Cascade does not consume that
 * representation, so this hook deliberately keeps only the indexed pieces the
 * shell still needs: interactions, activity, selection, region stats and the
 * global time cursor. No render-list materialization happens here.
 */
export function useTimeline({
  store,
  causality: _causality,
  cursor,
  fixApplied = false,
}: UseTimelineArgs) {
  const version = useTraceVersion(store, { kind: "global" });
  const caches = useRef({
    commits: derivationCache<CommitSummary[]>(),
    interactions: derivationCache<ReturnType<TraceStore["interactions"]>>(),
    activity: derivationCache<ReturnType<typeof buildActivity>>(),
    active: derivationCache<Array<[number, number]>>(),
    markers: derivationCache<Array<{ t: number; label: string; warn: boolean }>>(),
  }).current;

  const commits = caches.commits.read([store, version], () => store.commits());
  const interactions = caches.interactions.read([store, version], () => store.interactions());
  const bounds = store.timeBounds();

  const acts = caches.activity.read([store, version], () => {
    const fromIndex = store.activityIntervals(64);
    const intervals: Array<[number, number]> = fromIndex.length > 0 ? [...fromIndex] : [];
    for (const commit of commits) intervals.push([commit.timestamp, commit.endTimestamp]);
    for (const interaction of interactions) intervals.push([interaction.start, interaction.end]);
    if (intervals.length === 0) intervals.push([bounds.t0, bounds.t1]);
    return buildActivity(intervals);
  });

  const active = caches.active.read([store, version], () => {
    const spans: TimeSpan[] = [];
    for (const commit of commits) spans.push({ start: commit.timestamp, end: commit.endTimestamp });
    for (const interaction of interactions)
      spans.push({ start: interaction.start, end: interaction.end });
    return spans.length > 0
      ? mergeActive(spans)
      : ([[bounds.t0, bounds.t1]] as Array<[number, number]>);
  });

  const gapProgRef = useRef(new Map<string, number>());
  const ctxRef = useRef<TimelineContext>({ bounds, axis: buildAxis(acts, gapProgRef.current) });
  const [state, dispatch] = useReducer(
    (current: Parameters<typeof timelineReducer>[0], action: TimelineAction) =>
      timelineReducer(current, action, ctxRef.current),
    undefined,
    () => {
      const axis = buildAxis(acts, gapProgRef.current);
      return initialTimelineState({ view: { a0: 0, a1: axis.total } });
    },
  );

  const axis = buildAxis(acts, gapProgRef.current);
  ctxRef.current = { bounds, axis };
  const visible = wallWindow(axis, state.view);

  const statsRange = state.region ?? { start: visible.start, end: visible.end };
  const statsPair = statsPairFromStore(store, statsRange.start, statsRange.end);
  const statsRaw = statsPair.raw;
  const stats = fixApplied ? statsPair.excludeWasted : statsRaw;

  const markers = caches.markers.read([store, version], () => {
    const out: Array<{ t: number; label: string; warn: boolean }> = [];
    for (const interaction of interactions) {
      out.push({ t: interaction.start, label: interaction.label || "interaction", warn: false });
    }
    for (const commit of commits) {
      const duration = commit.endTimestamp - commit.timestamp;
      if (duration >= LONG_TASK_MS) {
        out.push({
          t: commit.timestamp,
          label: `long task ${Math.round(duration)} ms`,
          warn: true,
        });
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  });

  return {
    store,
    state,
    dispatch,
    gapProgRef,
    bounds,
    active,
    acts,
    axis,
    commits,
    interactions,
    markers,
    visible,
    stats,
    statsRaw,
    fixSavedRenders: Math.max(0, statsRaw.renders - stats.renders),
    playhead: cursor.mode === "live" ? bounds.t1 : cursor.t,
  };
}

export type Timeline = ReturnType<typeof useTimeline>;
