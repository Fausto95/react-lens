import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import {
  buildTree,
  flatten,
  parseQuery,
  type ComponentDatum,
  type SemanticNode,
} from "@reactlens/tree";
import { useTraceVersion } from "../useLens.js";
import { loadPanelPrefs, savePanelPrefs } from "../panelPrefs.js";
import { buildLanes, clipAtTime, statsInRegion } from "../timeline/model/lanes.js";
import { chainFor, edgesForCommit } from "../timeline/model/edges.js";
import {
  buildScale,
  clipActiveToView,
  countIdleGutters,
  IDLE_WIDTH,
  mergeActive,
  projectT,
  projectX,
  type TimeSpan,
} from "../timeline/model/scale.js";
import { compactGap } from "../timeline/ticks.js";
import { buildRenderStory } from "../inspector/renderStory.js";
import { startReplayTicker } from "../timeline/replayTicker.js";
import { isLaneVisible, typeLaneKey, type LaneControls, type LaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import { LanesView, laneViewRows, NAME_W, type View } from "./LanesView.js";
import { TreeView, treeViewRows } from "./TreeView.js";
import { InspectorView } from "./InspectorView.js";

const MIN_SPAN_MS = 120;
/** Historical scrub window when a clip is selected (concept ~700 ms). */
const DEFAULT_WINDOW_MS = 1200;
/** A commit over ~3 frames is worth pinning on the ruler. */
const LONG_TASK_MS = 50;
/** How far past the whole session you may zoom out, in session-spans. */
const MAX_ZOOM_OUT = 4;
/** Resolution of the zoom slider's fixed scale. */
const ZOOM_STEPS = 1000;

const TREE_MIN = 180;
const TREE_MAX = 520;
const INSP_MIN = 260;
const INSP_MAX = 620;

function clampPx(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
/** Verdicts are a causality walk per render — capped so the panel stays fast. */
const WHY_CAP = 400;

/**
 * The redesign shell: toolbar + three columns (Components · Timeline ·
 * Inspector), matching the interactive concept. Everything below is wired to
 * the real trace store — the concept's fixtures are gone.
 */
export function RedesignShell({
  store,
  causality,
  recording,
  cursor,
  onCursor,
  lanes,
  doctor,
  selected,
  onSelect,
  onHighlight,
  sessionSpanMs,
  toolbarActions,
  windowChrome = false,
}: {
  store: TraceStore;
  causality: Causality;
  recording: boolean;
  cursor: TimeCursor;
  onCursor: (c: TimeCursor) => void;
  lanes: LaneControls;
  doctor?: Set<ComponentId>;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  sessionSpanMs: number;
  /** The panel's existing actions (⌘K, agent, sessions…) live in the toolbar. */
  toolbarActions?: React.ReactNode;
  /**
   * The concept's faux traffic lights. Off in the real panel — it isn't a
   * window — but available for the playground and marketing site, which show
   * the panel as a screenshot-style card.
   */
  windowChrome?: boolean;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [filterChips, setFilterChips] = useState<string[]>([]);
  const [filterFree, setFilterFree] = useState("");
  const query = useMemo(
    () => [...filterChips, filterFree.trim()].filter(Boolean).join(" "),
    [filterChips, filterFree],
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [expandedLanes, setExpandedLanes] = useState<ReadonlySet<LaneKey>>(new Set());
  const [selectedRender, setSelectedRender] = useState<RenderId | null>(null);
  const [selectedLane, setSelectedLane] = useState<LaneKey | null>(null);
  const [region, setRegion] = useState<{ t0: number; t1: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [fixApplied, setFixApplied] = useState(false);
  const [flashId, setFlashId] = useState<ComponentId | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  /**
   * Column widths. The concept hard-codes 272px / 1fr / 320px; real sessions
   * need to trade width between the tree, the time axis and the inspector, so
   * the outer columns are draggable and persisted while the timeline takes
   * whatever is left.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const [treeW, setTreeW] = useState(() => loadPanelPrefs().treeWidth);
  const [inspW, setInspW] = useState(() => loadPanelPrefs().inspectorWidth);
  useEffect(() => {
    savePanelPrefs({ treeWidth: treeW, inspectorWidth: inspW });
  }, [treeW, inspW]);

  const startColumnDrag =
    (which: "tree" | "inspector") => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const host = gridRef.current;
      if (!host) return;
      // Listen on the window, not the handle: a drag that outruns the 7px
      // strip must keep tracking. (Pointer capture is unavailable for
      // synthetic pointers and throws, which would abort the drag entirely.)
      const move = (ev: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        if (which === "tree") {
          setTreeW(clampPx(ev.clientX - rect.left, TREE_MIN, TREE_MAX));
        } else {
          setInspW(clampPx(rect.right - ev.clientX, INSP_MIN, INSP_MAX));
        }
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  /**
   * Session bounds — every render, not just the commit range.
   *
   * Taking `commits[0].timestamp … commits.at(-1).endTimestamp` collapsed to a
   * near-zero span on a mount-only session (all commits land in the same
   * millisecond), which rendered a "0 ms window" with every clip crushed into
   * a sliver at the left edge. Span the actual renders and enforce a floor.
   */
  const bounds = useMemo(() => {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const instance of store.allInstances()) {
      for (const render of store.rendersOf(instance.id)) {
        lo = Math.min(lo, render.timestamp);
        hi = Math.max(hi, render.timestamp + Math.max(render.selfDuration, 0));
      }
    }
    for (const commit of store.commits()) {
      lo = Math.min(lo, commit.timestamp);
      hi = Math.max(hi, commit.endTimestamp);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { t0: 0, t1: MIN_SPAN_MS };
    return { t0: lo, t1: Math.max(hi, lo + MIN_SPAN_MS) };
  }, [store, version]);
  /**
   * The window. `null` means auto:
   *   - live → fit the whole session (idle gaps are compressed in the lane
   *     scale, so a click 40 s after mount still sits right after a gutter —
   *     same idea as v1's timeline)
   *   - historical → keep the playhead centered so a selected clip doesn't
   *     scroll off the left as the session grows
   *
   * A wall-clock "follow the tip" window stranded mount at t≈0 and parked the
   * playhead in empty idle; subsequent clicks looked missing. Any manual zoom
   * or pan pins the window and stops the auto follow.
   */
  const [view, setView] = useState<View | null>(null);
  const playhead = cursor.mode === "live" ? bounds.t1 : cursor.t;
  const autoView: View = (() => {
    if (cursor.mode === "live") {
      return { t0: bounds.t0, t1: bounds.t1 };
    }
    // Historical: center on the playhead, clamped to the session (+ air).
    const half = DEFAULT_WINDOW_MS / 2;
    let t0 = playhead - half;
    let t1 = playhead + half;
    if (t0 < bounds.t0 - half) {
      t0 = bounds.t0 - half;
      t1 = t0 + DEFAULT_WINDOW_MS;
    }
    if (t1 > bounds.t1 + half) {
      t1 = bounds.t1 + half;
      t0 = t1 - DEFAULT_WINDOW_MS;
    }
    return { t0, t1 };
  })();
  const effectiveView: View = view ?? autoView;
  const span = Math.max(1e-6, effectiveView.t1 - effectiveView.t0);

  // ── Lanes ────────────────────────────────────────────────────────────────
  const wastedSet = useMemo(() => {
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
          /* a render without snapshots has no verdict */
        }
      }
    }
    return set;
  }, [store, causality, version]);

  const laneModel = useMemo(
    () =>
      buildLanes(store, {
        include: (key) => isLaneVisible(lanes.filter, key),
        isWasted: (renderId) => wastedSet.has(renderId),
      }),
    [store, version, lanes.filter, wastedSet],
  );
  const laneRows = useMemo(
    () => laneViewRows(laneModel, expandedLanes),
    [laneModel, expandedLanes],
  );

  /**
   * Activity spans for idle-gap compression (v1 timeline geometry). Every clip
   * and interaction counts — long wall-clock gaps between them collapse to a
   * fixed gutter so mount and a later click sit next to each other.
   */
  const mergedActive = useMemo(() => {
    const spans: TimeSpan[] = [];
    for (const lane of laneModel) {
      for (const clip of lane.clips) {
        spans.push({ start: clip.t0, end: Math.max(clip.t1, clip.t0 + 0.05) });
      }
      for (const sub of lane.subs) {
        for (const clip of sub.clips) {
          spans.push({ start: clip.t0, end: Math.max(clip.t1, clip.t0 + 0.05) });
        }
      }
    }
    for (const it of store.interactions()) {
      spans.push({ start: it.start, end: Math.max(it.end, it.start + 1) });
    }
    return mergeActive(spans);
  }, [laneModel, store, version]);

  /**
   * Stats / tree heat use an explicit loop when the user set one; otherwise the
   * visible window. Never invent a "loop" overlay — that was why a blue region
   * appeared on every load without the user asking for one.
   */
  const statsRange = region ?? { t0: effectiveView.t0, t1: effectiveView.t1 };

  const stats = useMemo(
    () =>
      statsInRegion(laneModel, statsRange.t0, statsRange.t1, {
        excludeWasted: fixApplied,
      }),
    [laneModel, statsRange.t0, statsRange.t1, fixApplied],
  );
  /** Baseline region totals (including waste) — for the "−N renders" fix note. */
  const statsRaw = useMemo(
    () => statsInRegion(laneModel, statsRange.t0, statsRange.t1),
    [laneModel, statsRange.t0, statsRange.t1],
  );
  const fixSavedRenders = Math.max(0, statsRaw.renders - stats.renders);

  /**
   * Ruler pins: what the user did (interactions) and what hurt (commits over
   * the frame budget). Only those inside the window are drawn.
   */
  const markers = useMemo(() => {
    const out: Array<{ key: string; t: number; label: string; long: boolean }> = [];
    for (const it of store.interactions()) {
      if (it.start < effectiveView.t0 || it.start > effectiveView.t1) continue;
      out.push({ key: `i${it.id}`, t: it.start, label: it.label, long: false });
    }
    for (const commit of store.commits()) {
      if (commit.totalSelfTime < LONG_TASK_MS) continue;
      if (commit.timestamp < effectiveView.t0 || commit.timestamp > effectiveView.t1) continue;
      out.push({
        key: `c${commit.commitId}`,
        t: commit.timestamp,
        label: `long task ${Math.round(commit.totalSelfTime)} ms`,
        long: true,
      });
    }
    return out;
  }, [store, version, effectiveView.t0, effectiveView.t1]);

  const arrows = useMemo(() => {
    if (selectedRender === null) return [];
    return chainFor(edgesForCommit(store, selectedRender), selectedRender);
  }, [store, selectedRender, version]);

  /**
   * Open any repeated-component group the selected cascade reaches.
   *
   * Arrows anchor on real clip elements, and a collapsed group draws a density
   * band instead of clips — so a cascade into `ListItem ×8` would silently
   * lose all eight arrows. Expanding reveals the instances the edges point at.
   */
  useEffect(() => {
    if (arrows.length === 0) return;
    const touched = new Set<ComponentId>();
    for (const edge of arrows) {
      for (const id of [edge.from, edge.to]) {
        const componentId = store.getRender(id)?.componentId;
        if (componentId !== undefined) touched.add(componentId);
      }
    }
    const toOpen = laneModel
      .filter((lane) => lane.subs.length > 0)
      .filter((lane) => lane.subs.some((sub) => touched.has(sub.componentId)))
      .map((lane) => lane.key);
    if (toOpen.length === 0) return;
    setExpandedLanes((prev) => {
      if (toOpen.every((key) => prev.has(key))) return prev;
      const next = new Set(prev);
      for (const key of toOpen) next.add(key);
      return next;
    });
  }, [arrows, laneModel, store]);

  const story = useMemo(
    () => (selectedRender === null ? null : buildRenderStory(store, causality, selectedRender)),
    [store, causality, selectedRender, version],
  );
  const selectedRenderEvent = selectedRender !== null ? store.getRender(selectedRender) : undefined;

  /**
   * Scrubbing drives the inspector: as the playhead moves, pick the nearest
   * clip (preferring the selected lane) and rebuild Cause → Change → Cost → Fix.
   * Live mode is skipped so a recording session doesn't thrash the column.
   */
  const playheadRef = useRef(playhead);
  useEffect(() => {
    if (playheadRef.current === playhead) return;
    playheadRef.current = playhead;
    if (cursor.mode === "live") return;
    const clip = clipAtTime(laneModel, playhead, selectedLane);
    if (!clip || clip.renderId === selectedRender) return;
    setSelectedRender(clip.renderId);
    setSelectedLane(clip.laneKey);
    onSelect(clip.componentId);
  }, [playhead, cursor.mode, laneModel, selectedLane, selectedRender, onSelect]);

  // Flash a tree row briefly when a clip is picked.
  useEffect(() => {
    if (flashId === null) return;
    const id = window.setTimeout(() => setFlashId(null), 700);
    return () => window.clearTimeout(id);
  }, [flashId]);

  const selectTreeComponent = (id: ComponentId) => {
    onSelect(id);
    const name = store.instance(id)?.name;
    if (name) {
      const key = typeLaneKey(name);
      setSelectedLane(key);
      const laneEl = lanesHostRef.current?.querySelector(`[data-lane="${key}"]`);
      laneEl?.scrollIntoView({ block: "nearest" });
    }
  };

  const selectClip = (clip: {
    renderId: RenderId;
    laneKey: LaneKey;
    componentId: ComponentId;
    t0: number;
  }) => {
    setSelectedRender(clip.renderId);
    setSelectedLane(clip.laneKey);
    onSelect(clip.componentId);
    setFlashId(clip.componentId);
    // Drop any pinned window so the historical auto-view can center on this clip
    // — otherwise a follow-tail window keeps scrolling and the selection vanishes.
    setView(null);
    onCursor({ t: clip.t0, mode: "historical" });
  };

  // ── Tree ─────────────────────────────────────────────────────────────────
  const data = useMemo(() => buildData(store, causality), [store, causality, version]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const roots = useMemo(() => buildTree(data, { include: parsed.predicate }), [data, parsed]);
  const expanded = useMemo(() => {
    const set = new Set<string>();
    const walk = (nodes: SemanticNode[]) => {
      for (const node of nodes) {
        if (node.kind === "group") {
          if (openGroups.has(node.key)) set.add(node.key);
          walk(node.instances);
        } else {
          if (!collapsed.has(node.key)) set.add(node.key);
          walk(node.children);
        }
      }
    };
    walk(roots);
    return set;
  }, [roots, collapsed, openGroups]);
  const treeRows = useMemo(() => treeViewRows(flatten(roots, expanded)), [roots, expanded]);
  /** Match count for the filter affordance (query only, mode-independent). */
  const matchCount = useMemo(
    () => (query.trim() ? data.filter(parsed.predicate).length : null),
    [data, parsed, query],
  );
  const maxSelf = useMemo(
    () =>
      Math.max(
        1,
        ...treeRows.map(({ row }) =>
          row.node.kind === "component" ? row.node.datum.selfTime : row.node.selfTime,
        ),
      ),
    [treeRows],
  );

  /**
   * Watchlist: the components the Doctor flagged, heaviest first. The concept
   * pins a hand-picked list; here it earns its place from real findings.
   */
  const watchlist = useMemo(() => {
    if (!doctor || doctor.size === 0) return [];
    return [...doctor]
      .map((id) => ({
        id,
        name: store.instance(id)?.name ?? `#${id}`,
        issues: 1,
        renders: store.renderCount(id),
      }))
      .sort((a, b) => b.renders - a.renders)
      .slice(0, 3);
  }, [doctor, store, version]);

  // ── Interactions ─────────────────────────────────────────────────────────
  const lanesHostRef = useRef<HTMLDivElement>(null);
  const [trackW, setTrackW] = useState(480);
  useEffect(() => {
    const el = lanesHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const lanes = el.querySelector(".lanes") ?? el;
      const w = Math.max(1, lanes.clientWidth - NAME_W);
      setTrackW((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /**
   * v1-style idle compression: wall-clock gaps > IDLE_GAP_MS become a fixed
   * gutter, then active time stretches to fill the track. Mount + a click 40s
   * later sit next to each other instead of at opposite ends of empty time.
   */
  /**
   * Zoom level, as px per active millisecond: the width the CURRENT window
   * would need to exactly fill the track.
   */
  const pxPerMs = useMemo(() => {
    const clipped = clipActiveToView(mergedActive, effectiveView.t0, effectiveView.t1);
    const gutters = countIdleGutters(clipped, effectiveView.t0, effectiveView.t1);
    const activeMs = clipped.reduce((s, [a, b]) => s + (b - a), 0) || span;
    return Math.max(0.02, (trackW - gutters * IDLE_WIDTH) / activeMs);
  }, [mergedActive, effectiveView.t0, effectiveView.t1, trackW, span]);

  /**
   * The scale spans the WHOLE session at the current zoom, so the content is
   * wider than the viewport and the lanes scroll horizontally — a continuous
   * axis, like an NLE. Building it only across the visible window (with
   * `fillWidth: trackW`) made the content exactly fill the track by
   * construction, which is why there was nothing to scroll.
   *
   * Idle stretches stay in the model as compressed `idle` segments; the lanes
   * draw them as labelled gutters so a 40 s pause is visible as a gap you can
   * see and scroll through, not silently deleted.
   */
  const timeScale = useMemo(
    () => buildScale(mergedActive, bounds.t0, bounds.t1, pxPerMs),
    [mergedActive, bounds.t0, bounds.t1, pxPerMs],
  );
  const contentWidth = timeScale.width;
  /** Scroll offset that puts the current window at the viewport's left edge. */
  const scrollX = projectX(timeScale.segs, effectiveView.t0);

  /** Compressed gaps, labelled with the wall-clock time they stand for. */
  const idleSegs = useMemo(
    () =>
      timeScale.segs
        .filter((seg) => seg.idle)
        .map((seg) => ({ x0: seg.x0, x1: seg.x1, label: compactGap(seg.t1 - seg.t0) })),
    [timeScale],
  );

  const xOf = (t: number): number => projectX(timeScale.segs, t);
  const tOfClient = (clientX: number): number => {
    const el = lanesHostRef.current?.querySelector(".lanes-scroll") ?? lanesHostRef.current;
    if (!el) return effectiveView.t0;
    const rect = el.getBoundingClientRect();
    // Content coords: viewport offset + how far the canvas is scrolled.
    const x = clientX - rect.left - NAME_W + el.scrollLeft;
    return projectT(timeScale.segs, Math.min(Math.max(x, 0), contentWidth));
  };

  /** Scrolling IS panning: translate the new offset back into a window. */
  const onLanesScroll = (scrollLeft: number) => {
    const t0 = projectT(timeScale.segs, Math.max(0, scrollLeft));
    const t1 = projectT(timeScale.segs, Math.min(contentWidth, scrollLeft + trackW));
    if (Math.abs(t0 - effectiveView.t0) < 0.01 && Math.abs(t1 - effectiveView.t1) < 0.01) return;
    setView({ t0, t1 });
  };

  const scrub = (clientX: number) => {
    const t = tOfClient(clientX);
    onCursor({ t, mode: t >= bounds.t1 - 0.5 ? "live" : "historical" });
  };

  /**
   * Anchor for zoom: the playhead only when it's actually inside the window,
   * otherwise the region, otherwise the window's centre.
   *
   * Anchoring on the playhead unconditionally made zoom look broken while
   * live — the playhead sits at the session's trailing edge, so zooming in
   * dived into empty space past the last render and the lanes never changed.
   */
  const zoomAnchor = (): number => {
    if (playhead > effectiveView.t0 && playhead < effectiveView.t1) return playhead;
    if (region) return (region.t0 + region.t1) / 2;
    return effectiveView.t0 + span / 2;
  };

  /**
   * Pan limits — an editor timeline, not a box.
   *
   * The window may overscroll a full screen past each end, so you can always
   * drag along the axis (and see empty time ahead of a live recording) the way
   * an NLE or DAW does. Clamping the window strictly inside the recording left
   * nothing to pan at the default full-session zoom.
   */
  const clampT0 = (t0: number, width: number): number =>
    Math.min(Math.max(t0, bounds.t0 - width), Math.max(bounds.t0, bounds.t1));

  /**
   * Zoom slider on a FIXED 0–1000 scale (0 = fully out, 1000 = fully in),
   * mapped logarithmically to the window width.
   *
   * Binding the slider's `max` to the session length made the scale move under
   * the thumb: while recording, `bounds.t1` grows every commit, so the thumb
   * drifted on its own and could travel opposite to the button just pressed.
   * A constant scale depends only on the window:session ratio.
   */
  const widestSpan = Math.max(MIN_SPAN_MS * 2, (bounds.t1 - bounds.t0) * MAX_ZOOM_OUT);
  const zoomRange = Math.log(widestSpan / MIN_SPAN_MS);
  const spanToSlider = (w: number): number =>
    Math.round(
      ZOOM_STEPS *
        (1 - Math.log(Math.min(Math.max(w, MIN_SPAN_MS), widestSpan) / MIN_SPAN_MS) / zoomRange),
    );
  const sliderToSpan = (v: number): number =>
    MIN_SPAN_MS * Math.exp((1 - v / ZOOM_STEPS) * zoomRange);

  const setZoom = (width: number, anchor = zoomAnchor()) => {
    const sessionSpan = Math.max(MIN_SPAN_MS, bounds.t1 - bounds.t0);
    // Zooming out past the session is allowed (it frames the whole recording
    // with air around it); zooming in stops at MIN_SPAN_MS.
    const next = Math.min(Math.max(width, MIN_SPAN_MS), sessionSpan * MAX_ZOOM_OUT);
    const frac = (anchor - effectiveView.t0) / span;
    const t0 = clampT0(anchor - frac * next, next);
    setView({ t0, t1: t0 + next });
  };

  /**
   * Pan the visible time window.
   *
   * At (near) full-session fit the scale always fill-stretches every active
   * clip across the track — sliding the window by a few ms still contains the
   * same activity, so the lanes look frozen. Zoom into a navigable window
   * first, then shift it. Once zoomed, delta is proportional to the track so
   * a swipe moves content 1:1 with the finger.
   */
  const panByPx = (deltaPx: number, anchorT?: number) => {
    if (!Number.isFinite(deltaPx) || Math.abs(deltaPx) < 0.5) return;
    const sessionSpan = Math.max(MIN_SPAN_MS, bounds.t1 - bounds.t0);
    let width = span;
    let t0 = effectiveView.t0;

    // Full-session fit fill-stretches the same clips across the track, so a
    // tiny window slide looks frozen. Narrow first when that actually helps.
    const target = Math.max(
      MIN_SPAN_MS,
      Math.min(sessionSpan * 0.4, Math.max(DEFAULT_WINDOW_MS, sessionSpan * 0.3)),
    );
    if ((view === null || width >= sessionSpan * 0.9) && target < width * 0.9) {
      width = target;
      t0 = clampT0((anchorT ?? zoomAnchor()) - width / 2, width);
    }

    const deltaMs = (deltaPx / Math.max(1, trackW)) * width;
    if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) < 1e-6) return;
    const nextT0 = clampT0(t0 + deltaMs, width);
    if (Math.abs(nextT0 - effectiveView.t0) < 1e-4 && Math.abs(width - span) < 1e-4) return;
    setView({ t0: nextT0, t1: nextT0 + width });
  };

  // Keep the latest pan/zoom closures in a ref so the wheel listener can stay
  // attached. Re-binding on every live commit (playhead/timeScale deps) was
  // tearing the listener down mid-gesture and made horizontal pan feel dead.
  const wheelApiRef = useRef({
    panByPx,
    setZoom,
    tOfClient,
    span,
  });
  wheelApiRef.current = { panByPx, setZoom, tOfClient, span };

  const wheelDetachRef = useRef<(() => void) | null>(null);
  const attachWheel = useCallback((el: HTMLDivElement | null) => {
    wheelDetachRef.current?.();
    wheelDetachRef.current = null;
    lanesHostRef.current = el;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const api = wheelApiRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0035);
        api.setZoom(api.span * factor, api.tOfClient(e.clientX));
        return;
      }
      const horizontal =
        e.shiftKey || (Math.abs(e.deltaX) > 1.5 && Math.abs(e.deltaX) >= Math.abs(e.deltaY));
      if (!horizontal) return;
      e.preventDefault();
      e.stopPropagation();
      const deltaPx = e.shiftKey ? e.deltaY : e.deltaX;
      api.panByPx(deltaPx, api.tOfClient(e.clientX));
    };
    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    wheelDetachRef.current = () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);
  useEffect(() => () => wheelDetachRef.current?.(), []);

  /**
   * Build (or reuse) the loop region the playhead will cycle. Prefer the latest
   * interaction / activity cluster so Space after "Add to cart" loops that
   * cascade — never the whole idle session.
   */
  const resolveLoopRegion = (): { t0: number; t1: number } => {
    if (region && region.t1 > region.t0) return region;
    const lastIx = store.interactions().at(-1);
    if (lastIx) {
      const pad = Math.max(40, (lastIx.end - lastIx.start) * 0.15);
      return {
        t0: Math.max(bounds.t0, lastIx.start - pad),
        t1: Math.min(bounds.t1, Math.max(lastIx.end + pad, lastIx.start + 80)),
      };
    }
    const last = mergedActive.at(-1);
    if (last) {
      const pad = Math.max(40, (last[1] - last[0]) * 0.15);
      return {
        t0: Math.max(bounds.t0, last[0] - pad),
        t1: Math.min(bounds.t1, Math.max(last[1] + pad, last[0] + 80)),
      };
    }
    const mid = playhead;
    return {
      t0: Math.max(bounds.t0, mid - 200),
      t1: Math.min(bounds.t1, mid + 200),
    };
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    const r = resolveLoopRegion();
    setRegion(r);
    if (playhead < r.t0 || playhead > r.t1) {
      onCursor({ t: r.t0, mode: "historical" });
    }
    setPlaying(true);
  };

  /**
   * Region playback — only runs when the user started play (and therefore has
   * an intentional loop). Bounds live in a ref so a growing live session does
   * not restart the ticker every ingest.
   */
  const loopRef = useRef({ lo: 0, hi: 0 });
  loopRef.current = {
    lo: region?.t0 ?? bounds.t0,
    hi: region?.t1 ?? bounds.t1,
  };
  useEffect(() => {
    if (!playing || !region) {
      if (playing && !region) setPlaying(false);
      return;
    }
    const { lo, hi } = loopRef.current;
    if (hi <= lo) {
      setPlaying(false);
      return;
    }
    // Match the concept: one full pass through the selection in ~2 s.
    const durationMs = 2000;
    const ticker = startReplayTicker(durationMs, true, (frac) => {
      const { lo: a, hi: b } = loopRef.current;
      onCursor({ t: a + (b - a) * frac, mode: "historical" });
    });
    return () => ticker.stop();
  }, [playing, region, onCursor]);

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlayRef.current();
      }
      if (e.key === "Escape") {
        if (!region) return;
        e.preventDefault();
        setPlaying(false);
        setRegion(null);
      }
      if (e.key === "ArrowLeft") onCursor({ t: playhead - span * 0.02, mode: "historical" });
      if (e.key === "ArrowRight") onCursor({ t: playhead + span * 0.02, mode: "historical" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead, span, onCursor, region]);

  const toggleTree = (key: string) => {
    const setter = key.startsWith("g:") ? setOpenGroups : setCollapsed;
    setter((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  /** Structured tokens (`renders:>10`) render as chips; free text stays in the input. */
  const commitFilterTokens = (raw: string) => {
    const bits = raw.trim().split(/\s+/).filter(Boolean);
    const structured = bits.filter((t) => t.includes(":"));
    const rest = bits.filter((t) => !t.includes(":"));
    if (structured.length === 0) return false;
    setFilterChips((prev) => [...prev, ...structured.filter((t) => !prev.includes(t))]);
    setFilterFree(rest.join(" "));
    return true;
  };
  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && filterFree === "" && filterChips.length > 0) {
      e.preventDefault();
      setFilterChips((prev) => prev.slice(0, -1));
      return;
    }
    if (e.key !== " " && e.key !== "Enter") return;
    if (commitFilterTokens(filterFree)) e.preventDefault();
  };

  return (
    <>
      <div className="toolbar">
        {windowChrome && (
          <div className="dots">
            <i />
            <i />
            <i />
          </div>
        )}
        <div className="brand">
          <span className="lens" />
          React Lens
        </div>
        <div className="rec">
          {recording && <i />}
          {recording ? `Recording · ${(sessionSpanMs / 1000).toFixed(1)} s` : "Paused"}
        </div>
        <span className="hint">
          drag ruler to scrub · click clips · S/M in tree · space to loop · esc clears loop
        </span>
        <div className="legend">
          {(["props", "state", "ctx", "cascade"] as const).map((key) => (
            <span key={key}>
              <i className="sw" style={{ background: `var(--${key})` }} />
              {key === "ctx" ? "context" : key}
            </span>
          ))}
        </div>
        {toolbarActions}
        <span className="kbd">⌘K</span>
      </div>

      <div
        className="grid"
        ref={gridRef}
        style={{ gridTemplateColumns: `${treeW}px minmax(0, 1fr) ${inspW}px` }}
      >
        {/* Column dividers — drag to rebalance components / timeline / inspector. */}
        <div
          className="colresize"
          style={{ left: treeW }}
          title="Drag to resize"
          onPointerDown={startColumnDrag("tree")}
        />
        <div
          className="colresize"
          style={{ right: inspW }}
          title="Drag to resize"
          onPointerDown={startColumnDrag("inspector")}
        />
        <div className="col">
          <div className="colhead">Components</div>
          <div className="filter">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5C5C66"
              strokeWidth="2.4"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            {filterChips.map((token) => (
              <span
                key={token}
                className="chip"
                title="Click to remove"
                role="button"
                tabIndex={0}
                onClick={() => setFilterChips((prev) => prev.filter((t) => t !== token))}
                onKeyDown={(e) =>
                  e.key === "Enter" && setFilterChips((prev) => prev.filter((t) => t !== token))
                }
              >
                {token}
              </span>
            ))}
            <input
              ref={filterRef}
              className="rl-tree-search"
              placeholder={filterChips.length > 0 ? "Filter…" : "Filter components…"}
              value={filterFree}
              spellCheck={false}
              aria-invalid={parsed.errors.length > 0}
              {...(parsed.errors.length > 0 ? { title: parsed.errors.join(" · ") } : {})}
              onChange={(e) => setFilterFree(e.target.value)}
              onKeyDown={onFilterKeyDown}
              onBlur={() => commitFilterTokens(filterFree)}
            />
            {parsed.errors.length > 0 ? (
              <span className="rl-tree-search-count invalid">!</span>
            ) : (
              matchCount !== null && <span className="rl-tree-search-count">{matchCount}</span>
            )}
          </div>
          <TreeView
            rows={treeRows}
            maxSelf={maxSelf}
            selected={selected}
            onSelect={selectTreeComponent}
            onToggle={toggleTree}
            watchlist={watchlist}
            lanes={lanes}
            regionHeat={statsRaw.byLane}
            fixApplied={fixApplied}
            flashId={flashId}
            {...(doctor ? { doctor } : {})}
            {...(onHighlight ? { onHover: onHighlight } : {})}
          />
        </div>

        <div className="col">
          <div className="colhead">
            Timeline
            <span className="right">
              {region
                ? `selection ${Math.round(region.t0 - bounds.t0).toLocaleString("en-US")} – ${Math.round(
                    region.t1 - bounds.t0,
                  ).toLocaleString("en-US")} ms`
                : `${Math.round(span).toLocaleString("en-US")} ms window`}
            </span>
          </div>
          <div className="tl" ref={attachWheel}>
            <div className="ruler">
              <div className="rspacer" />
              <div
                className="rtrack"
                onPointerDown={(e) => {
                  scrub(e.clientX);
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) scrub(e.clientX);
                }}
              >
                {ticksFor(effectiveView, bounds.t0).map((tick) => (
                  <div
                    key={tick.t}
                    className="tick"
                    style={{ left: `${(xOf(tick.t) / trackW) * 100}%` }}
                  >
                    <span>{tick.label}</span>
                  </div>
                ))}
                {/* Interaction + long-task markers, the concept's ruler pins. */}
                {markers.map((marker) => (
                  <div
                    key={marker.key}
                    className={`marker${marker.long ? " long" : ""}`}
                    style={{ left: `${(xOf(marker.t) / trackW) * 100}%` }}
                    title={marker.label}
                  >
                    <i>{marker.long ? "!" : "◆"}</i>
                    {span < 2500 ? marker.label : ""}
                  </div>
                ))}
              </div>
            </div>

            <LanesView
              rows={laneRows}
              region={region}
              playhead={playhead}
              timeOrigin={bounds.t0}
              xOf={xOf}
              scrollX={scrollX}
              onScroll={onLanesScroll}
              scaleWidth={timeScale.width}
              idleSegs={idleSegs}
              selectedRender={selectedRender}
              selectedLane={selectedLane}
              arrows={arrows}
              lanes={lanes}
              fixApplied={fixApplied}
              onToggleExpand={(key) =>
                setExpandedLanes((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
              onSelectLane={setSelectedLane}
              onSelectClip={selectClip}
              {...(onHighlight ? { onHighlight } : {})}
              onScrub={scrub}
              onPan={panByPx}
              onRegionEdge={(side, clientX) => {
                const t = tOfClient(clientX);
                setRegion((r) => {
                  const base = r ?? {
                    t0: Math.min(t, playhead),
                    t1: Math.max(t, playhead),
                  };
                  const next = { ...base, [side]: t };
                  return next.t0 <= next.t1 ? next : { t0: next.t1, t1: next.t0 };
                });
              }}
            />

            <div className="tlfoot">
              <span
                className={`btn${playing ? " active" : ""}`}
                role="button"
                tabIndex={0}
                title={
                  region ? "Loop selection (space) · Esc clears" : "Loop latest interaction (space)"
                }
                onClick={togglePlay}
              >
                {playing ? "⏸" : "▶"}
              </span>
              <span>
                {region ? "In selection" : "In view"}: <b>{stats.renders} renders</b>
              </span>
              {stats.wasted > 0 && (
                <span className="mono" style={{ color: "var(--warn)" }}>
                  {stats.wasted} wasted
                </span>
              )}
              <span className="mono">total {stats.selfMs.toFixed(0)} ms</span>
              <span className={`fixnote${fixApplied ? " show" : ""}`}>
                {fixApplied
                  ? `fix applied · −${fixSavedRenders} render${fixSavedRenders === 1 ? "" : "s"}`
                  : "replaying with fix"}
              </span>
              {view !== null && (
                <span
                  className="btn"
                  role="button"
                  tabIndex={0}
                  title="Fit the full session again (idle gaps compressed)"
                  onClick={() => {
                    setView(null);
                    onCursor({ t: bounds.t1, mode: "live" });
                  }}
                >
                  follow
                </span>
              )}
              <div className="zoom">
                <span
                  className="btn"
                  role="button"
                  tabIndex={0}
                  onClick={() => setZoom(span * 1.4)}
                >
                  −
                </span>
                {/* Inverted: the slider is a ZOOM level, so dragging right
                    zooms in. Bound directly to the window width it ran
                    backwards — zooming in slid the thumb left. */}
                <input
                  type="range"
                  min={0}
                  max={ZOOM_STEPS}
                  step={1}
                  value={spanToSlider(span)}
                  onChange={(e) => setZoom(sliderToSpan(Number(e.target.value)))}
                />
                <span
                  className="btn"
                  role="button"
                  tabIndex={0}
                  onClick={() => setZoom(span * 0.72)}
                >
                  +
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="col insp">
          <InspectorView
            store={store}
            componentId={selectedRenderEvent?.componentId ?? selected}
            story={story}
            t0={selectedRenderEvent ? selectedRenderEvent.timestamp - bounds.t0 : null}
            t1={
              selectedRenderEvent
                ? selectedRenderEvent.timestamp - bounds.t0 + selectedRenderEvent.selfDuration
                : null
            }
            fixApplied={fixApplied}
            onToggleFix={() => setFixApplied((v) => !v)}
            onSelectComponent={selectTreeComponent}
            onHoverComponent={(id) => {
              onHighlight?.(id);
              if (id === null) return;
              const name = store.instance(id)?.name;
              if (name) setSelectedLane(typeLaneKey(name));
            }}
          />
        </div>
      </div>
    </>
  );
}

/** Ticks label time from session start, so panning doesn't restart the axis. */
function ticksFor(view: View, origin: number): Array<{ t: number; label: string }> {
  const span = view.t1 - view.t0;
  const raw = span / 6;
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
  let step = 10 * power;
  for (const m of [1, 2, 5, 10]) {
    if (m * power >= raw) {
      step = m * power;
      break;
    }
  }
  const out: Array<{ t: number; label: string }> = [];
  for (let t = Math.ceil(view.t0 / step) * step; t < view.t1; t += step) {
    out.push({
      t,
      label: `${Math.round(t - origin).toLocaleString("en-US")}${t + step >= view.t1 ? " ms" : ""}`,
    });
  }
  return out;
}

function buildData(store: TraceStore, causality: Causality): ComponentDatum[] {
  return store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => {
      let observableChange: boolean | null = null;
      const last = store.rendersOf(i.id).at(-1);
      if (last) {
        try {
          const verdict = causality.why(last.renderId).verdict;
          observableChange =
            verdict === "no-observable-change" ? false : verdict === "expected" ? true : null;
        } catch {
          observableChange = null;
        }
      }
      return {
        id: i.id,
        name: i.name,
        renders: store.renderCount(i.id),
        selfTime: store.selfTimeTotal(i.id),
        compiled: i.compiler.compiled,
        observableChange,
        ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
        ...(i.kind && i.kind !== "component" ? { kind: i.kind } : {}),
      } satisfies ComponentDatum;
    });
}
