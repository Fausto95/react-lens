import { Fragment, useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import {
  anomalyStats,
  type AnomalyStats,
  type TraceStore,
  type Interaction,
  type CommitSummary,
} from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId } from "@react-lens/protocol";
import { explainInteraction, type LensRef, type NarrativeNextClick } from "@react-lens/explain";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconFitSelection,
  IconFitWidth,
  IconMinus,
  IconPause,
  IconPlay,
  IconPlus,
  IconRewind,
  IconSkipBack,
  IconSkipForward,
  IconSparkle,
} from "@react-lens/icons";
import { SLOW_SELF_MS, renderFixPrompt, commitFixPrompt } from "./perfBudget.js";
import { useTraceVersion } from "./useLens.js";
import { ms, timeAxis } from "@react-lens/ui";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import type { RestoreStatus } from "./timeTravelController.js";
import { NarrativeCard } from "./NarrativeCard.js";
import { diagnoseOne } from "./doctor.js";
import { RestoreStatusPill, type RestoreFailureItem } from "./timeline/RestoreStatusPill.js";
import {
  INNER_RIGHT_PAD,
  SCALE_MAX,
  SCALE_MIN,
  buildScale,
  clamp,
  clampPaneHeight,
  countIdleGutters,
  fitPlan,
  IDLE_WIDTH,
  mergeActive,
  nearest,
  projectT,
  projectX,
  sessionBounds,
} from "./timeline/geometry.js";
import { buildTicks, compactGap } from "./timeline/ticks.js";
import { startReplayTicker, type ReplayTicker } from "./timeline/replayTicker.js";
import { timelineKeyAction } from "./timeline/keymap.js";
import { packPhaseBars, type PackedBar } from "./timeline/pack.js";
import { aggregateBars, visibleChunkRange, type ChunkRange } from "./timeline/lod.js";
import { ABDiffPanel } from "./timeline/ABDiffPanel.js";
import { DomSnapshotView } from "./timeline/DomSnapshotView.js";
import { loadPanelPrefs, savePanelPrefs } from "./panelPrefs.js";
import { compareApplySets } from "@react-lens/trace-engine";

const SNAP_PX = 6;
/** Shift-drag must travel this many px before it becomes a zoom band (else it's a B mark). */
const BAND_THRESHOLD_PX = 4;
/** Wasted-render verdicts computed per repack, detail bars first. */
const WHY_CAP = 80;

/**
 * Video-editor-style time machine: interaction / commit tracks plus a
 * phase-packed component waterfall (no persistent component lanes).
 */
export function Timeline({
  store,
  causality,
  cursor,
  ab,
  onCursor,
  onSetAB,
  onReplay,
  travel,
  offline = false,
  onSelectComponent,
  onHighlight,
  onAskAI,
  selectedComponent = null,
  explainToken = 0,
}: {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  ab: ABMarks;
  onCursor: (c: TimeCursor) => void;
  onSetAB: (ab: ABMarks) => void;
  onReplay?: (ids: ComponentId[]) => void;
  /** Real time travel: page state follows the playhead while scrubbing. */
  travel?: {
    on: boolean;
    supported: boolean;
    toggle: () => void;
    /** Set-wide restore state (null while live / not traveling). */
    status?: RestoreStatus | null;
  };
  /** An imported session is loaded — the live page no longer matches it. */
  offline?: boolean;
  onSelectComponent?: (id: ComponentId) => void;
  /** Highlight DOM hosts on the page (same as tree hover). */
  onHighlight?: (id: ComponentId | null) => void;
  /** Inline "Fix with AI" on renders/commits over the frame budget. */
  onAskAI?: (question: string) => void;
  /** Currently selected component — keeps page highlight sticky after a bar click. */
  selectedComponent?: ComponentId | null;
  /** Increment to open Explain for the current selection (⌘K). */
  explainToken?: number;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const interactions = useMemo(() => store.interactions(), [store, version]);
  const commits = useMemo(() => store.commits(), [store, version]);
  // Resizable pane: collapsed toggle (T) + persisted waterfall-lane height.
  const [collapsed, setCollapsedState] = useState(() => loadPanelPrefs().tlCollapsed);
  const [paneH, setPaneHState] = useState(() => clampPaneHeight(loadPanelPrefs().tlPaneH));
  const rootRef = useRef<HTMLDivElement>(null);
  const setCollapsed = (update: (v: boolean) => boolean) =>
    setCollapsedState((v) => {
      const next = update(v);
      savePanelPrefs({ tlCollapsed: next });
      return next;
    });
  const setPaneH = (h: number) => {
    const next = clampPaneHeight(h);
    setPaneHState(next);
    savePanelPrefs({ tlPaneH: next });
  };
  const [scale, setScale] = useState(0); // px/ms; 0 = auto-fit to viewport
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const draggingPlayhead = useRef(false);
  const tickerRef = useRef<ReplayTicker | null>(null);
  /** Applied after the scale model commits so scrollLeft isn't clamped to the old width. */
  const pendingScrollRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Shift-drag zoom band (inner-canvas px); anchor survives until pointer-up.
  const bandAnchor = useRef<{ clientX: number; pointerId: number } | null>(null);
  const [band, setBand] = useState<{ x0: number; x1: number } | null>(null);
  // A→B apply-set diff panel.
  const [abPanelOpen, setAbPanelOpen] = useState(false);
  // Scroll drives DOM directly (--rl-scroll-x + minimap window); the only
  // scroll-driven React state is the coarse culling window below.
  const [chunks, setChunks] = useState<ChunkRange>(() => visibleChunkRange(0, 760));
  const minimapCtl = useRef<{ update(viewStart: number, viewEnd: number): void } | null>(null);

  const bounds = useMemo(() => sessionBounds(interactions, commits), [interactions, commits]);
  const anomaly = useMemo(() => anomalyStats(commits), [commits]);

  const active = useMemo(() => mergeActive(interactions), [interactions]);
  const activeSpan = useMemo(() => active.reduce((s, [a, b]) => s + (b - a), 0) || 1, [active]);
  const idleGutters = useMemo(
    () => countIdleGutters(active, bounds.t0, bounds.t1),
    [active, bounds.t0, bounds.t1],
  );
  // Auto-fit: stretch active time across the full scroll viewport (no px/ms cap).
  const viewW = viewportW > 0 ? viewportW : 760;
  const fit = Math.max(
    0.02,
    (Math.max(240, viewW) - idleGutters * IDLE_WIDTH - INNER_RIGHT_PAD) / activeSpan,
  );
  const px = scale || fit;
  const model = useMemo(
    () => buildScale(active, bounds.t0, bounds.t1, px, scale ? undefined : viewW),
    [active, bounds, px, scale, viewW],
  );
  const innerWidth = model.width;
  const xOf = useCallback(
    (t: number) => projectX(model.segs, clamp(t, bounds.t0, bounds.t1)),
    [model.segs, bounds.t0, bounds.t1],
  );
  const tOfX = useCallback(
    (x: number) => projectT(model.segs, clamp(x, 0, innerWidth)),
    [model.segs, innerWidth],
  );
  const tOfClient = useCallback(
    (clientX: number) => {
      const inner = innerRef.current;
      if (!inner) return bounds.t0;
      return tOfX(clientX - inner.getBoundingClientRect().left);
    },
    [tOfX, bounds.t0],
  );

  /**
   * One DOM pass per scroll/zoom: sticky labels read --rl-scroll-x from CSS
   * (no React render), the minimap window is repositioned imperatively, and
   * the culling window only updates state when a 512px chunk boundary crosses.
   */
  const syncScrollUi = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    innerRef.current?.style.setProperty("--rl-scroll-x", `${el.scrollLeft}px`);
    minimapCtl.current?.update(tOfX(el.scrollLeft), tOfX(el.scrollLeft + el.clientWidth));
    const next = visibleChunkRange(el.scrollLeft, el.clientWidth || 760);
    setChunks((prev) => (prev.c0 === next.c0 && prev.c1 === next.c1 ? prev : next));
  }, [tOfX]);

  // Run after layout so the new inner width exists before we set scrollLeft.
  useLayoutEffect(() => {
    const x = pendingScrollRef.current;
    if (x != null) {
      pendingScrollRef.current = null;
      const el = scrollRef.current;
      if (el) el.scrollLeft = x;
    }
    // The time↔px mapping changed even when scrollLeft didn't — resync.
    syncScrollUi();
  }, [model, scale, syncScrollUi]);

  // Keep sticky labels / minimap / culling in sync with horizontal scroll.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncScrollUi();
    el.addEventListener("scroll", syncScrollUi, { passive: true });
    return () => el.removeEventListener("scroll", syncScrollUi);
  }, [collapsed, interactions.length, syncScrollUi]);

  const snapTargets = useMemo(() => {
    const ts: number[] = [];
    for (const it of interactions) {
      ts.push(it.start, it.end);
    }
    for (const c of commits) ts.push(c.timestamp);
    return ts;
  }, [interactions, commits]);

  const snapT = useCallback(
    (t: number): number => {
      const x = xOf(t);
      let best = t;
      let bestDist = SNAP_PX + 1;
      for (const s of snapTargets) {
        const d = Math.abs(xOf(s) - x);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      return bestDist <= SNAP_PX ? best : t;
    },
    [snapTargets, xOf],
  );

  const stop = useCallback(() => {
    tickerRef.current?.stop();
    setPlaying(false);
  }, []);

  const play = useCallback(
    (fromT: number, toT: number, loop = false) => {
      const segs = model.segs;
      const startX = projectX(segs, clamp(fromT, bounds.t0, bounds.t1));
      const endX = projectX(segs, clamp(toT, bounds.t0, bounds.t1));
      tickerRef.current?.stop();
      if (endX <= startX) {
        onCursor({ t: bounds.t1, mode: "live" });
        return;
      }
      const durMs = clamp((endX - startX) * 6, 700, 4000);
      let lastSentT: number | null = null;
      const traveling = travel?.on ?? false;
      setPlaying(true);
      // Frame-delta pacing with a timer fallback (see replayTicker): stalls
      // pause playback instead of skipping it, and replay keeps advancing
      // even while the document gets no animation frames.
      tickerRef.current = startReplayTicker(durMs, loop, (frac, done) => {
        const rawT = projectT(segs, startX + (endX - startX) * frac);
        // With real travel on, commits ARE the replay's frames: the apply set
        // only changes at commits, so quantize to commit boundaries and apply
        // each commit as ONE atomic delta. Sweeping smoothly through a
        // commit's span instead streamed its renders as hundreds of partial
        // deltas — each a synchronous React flush — which crawled or, under
        // wall-clock pacing, skipped the replay entirely.
        const t = traveling ? (store.commitAt(rawT)?.endTimestamp ?? rawT) : rawT;
        if (done || t !== lastSentT) {
          lastSentT = t;
          onCursor({ t, mode: done ? "live" : "historical" });
        }
        if (done) setPlaying(false);
      });
    },
    [model.segs, bounds.t0, bounds.t1, onCursor, store, travel?.on],
  );

  useEffect(() => () => tickerRef.current?.stop(), []);

  // Fit auto-scale to the scroll viewport so clips fill the available width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setViewportW((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, interactions.length]);

  useEffect(() => {
    if (interactions.length === 0) {
      setSelectedId(null);
      stop();
    }
  }, [interactions.length, stop]);

  const selected = interactions.find((i) => i.id === selectedId) ?? null;

  // Seed / repair selection, but honor an intentional clear (selectedId === null).
  const prevInteractionCount = useRef(0);
  useEffect(() => {
    const n = interactions.length;
    if (n === 0) {
      setSelectedId(null);
    } else if (prevInteractionCount.current === 0 && selectedId == null) {
      setSelectedId(interactions.at(-1)!.id);
    } else if (selectedId != null && !interactions.some((i) => i.id === selectedId)) {
      setSelectedId(interactions.at(-1)?.id ?? null);
    }
    prevInteractionCount.current = n;
  }, [interactions, selectedId]);

  const selectAt = useCallback(
    (t: number) => {
      const hit = interactions.find((i) => t >= i.start && t <= i.end) ?? nearest(interactions, t);
      setSelectedId(hit?.id ?? null);
    },
    [interactions],
  );

  const scrubToT = useCallback(
    (raw: number) => {
      const t = snapT(raw);
      onCursor({ t, mode: t >= bounds.t1 - 0.5 ? "live" : "historical" });
      selectAt(t);
    },
    [snapT, onCursor, bounds.t1, selectAt],
  );

  const scrubToClient = useCallback(
    (clientX: number) => scrubToT(tOfClient(clientX)),
    [scrubToT, tOfClient],
  );

  const stepInteraction = useCallback(
    (dir: 1 | -1) => {
      if (interactions.length === 0) return;
      const here = cursor.mode === "historical" ? cursor.t : bounds.t1;
      const starts = interactions.map((i) => i.start);
      const next =
        dir > 0
          ? starts.find((s) => s > here + 0.01)
          : [...starts].reverse().find((s) => s < here - 0.01);
      if (next !== undefined) {
        onCursor({ t: next, mode: "historical" });
        selectAt(next);
      }
    },
    [interactions, cursor, bounds.t1, onCursor, selectAt],
  );

  const stepCommit = useCallback(
    (dir: 1 | -1) => {
      if (commits.length === 0) return;
      const here = cursor.mode === "historical" ? cursor.t : bounds.t1;
      const times = commits.map((c) => c.timestamp);
      const next =
        dir > 0
          ? times.find((s) => s > here + 0.01)
          : [...times].reverse().find((s) => s < here - 0.01);
      if (next !== undefined) {
        onCursor({ t: next, mode: "historical" });
        selectAt(next);
      }
    },
    [commits, cursor, bounds.t1, onCursor, selectAt],
  );

  const fitSession = useCallback(() => {
    pendingScrollRef.current = 0;
    if (scale === 0) {
      const el = scrollRef.current;
      if (el) el.scrollLeft = 0;
      pendingScrollRef.current = null;
    } else {
      setScale(0);
    }
  }, [scale]);

  /** Zoom to an arbitrary time range (drag-zoom, fit-selection, minimap edges). */
  const fitRange = useCallback(
    (start: number, end: number) => {
      const el = scrollRef.current;
      const port = el?.clientWidth || viewW;
      const plan = fitPlan(active, bounds, { start, end }, port);
      pendingScrollRef.current = plan.scrollLeft;
      if (plan.scale === scale) {
        // No scale change → layout effect won't re-fire; scroll now.
        requestAnimationFrame(() => {
          if (pendingScrollRef.current == null) return;
          const sc = scrollRef.current;
          if (sc) sc.scrollLeft = pendingScrollRef.current;
          pendingScrollRef.current = null;
        });
      } else {
        setScale(plan.scale);
      }
    },
    [active, bounds, scale, viewW],
  );

  const fitSelection = useCallback(
    (it: Interaction) => {
      setSelectedId(it.id);
      onCursor({ t: it.start, mode: "historical" });
      fitRange(it.start, it.end);
    },
    [fitRange, onCursor],
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      stop();
      return;
    }
    // Scrub forward from the playhead (or session start when live) and flash
    // the update wave for the components that commit from that point onward —
    // with time travel on it rides on top of the real state replay so the
    // updating regions stay visible on the page.
    const from = cursor.mode === "historical" ? cursor.t : bounds.t0;
    const ids = sessionComponentIds(commits, from);
    if (ids.length > 0) onReplay?.(ids);
    play(from, bounds.t1, false);
  }, [playing, stop, play, cursor, bounds, commits, onReplay]);

  /**
   * Rescale while keeping the time under `viewportX` (px from the viewport's
   * left edge) visually pinned. Wheel zoom anchors at the pointer; the −/+
   * buttons anchor at the viewport center so the view never jumps away.
   */
  const zoomTo = useCallback(
    (next: number, viewportX: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = clamp(next, SCALE_MIN, SCALE_MAX);
      const tAnchor = tOfX(el.scrollLeft + viewportX);
      setScale(clamped);
      requestAnimationFrame(() => {
        const newModel = buildScale(active, bounds.t0, bounds.t1, clamped);
        const newX = projectX(newModel.segs, clamp(tAnchor, bounds.t0, bounds.t1));
        pendingScrollRef.current = Math.max(0, newX - viewportX);
        // Force layout effect if scale didn't change enough to rebuild; apply now too.
        const sc = scrollRef.current;
        if (sc) sc.scrollLeft = pendingScrollRef.current;
        pendingScrollRef.current = null;
      });
    },
    [tOfX, active, bounds.t0, bounds.t1],
  );

  const zoomButtons = useCallback(
    (factor: number) => {
      const el = scrollRef.current;
      if (!el) return;
      zoomTo((scale || fit) * factor, el.clientWidth / 2);
    },
    [zoomTo, scale, fit],
  );


  // Keyboard: T, L, F, [ ], Space, arrows — matching lives in timeline/keymap
  // so bindings stay layout-independent (AZERTY etc.).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const action = timelineKeyAction(e);
      if (!action) return;
      switch (action.kind) {
        case "toggle-collapse":
          setCollapsed((v) => !v);
          break;
        case "escape-band":
          if (bandAnchor.current) {
            bandAnchor.current = null;
            setBand(null);
          }
          break;
        case "go-live":
          onCursor({ t: bounds.t1, mode: "live" });
          break;
        case "fit":
          if (selected) fitSelection(selected);
          else fitSession();
          break;
        case "step-interaction":
          stepInteraction(action.dir);
          break;
        case "zoom":
          zoomButtons(action.factor);
          break;
        case "toggle-play":
          e.preventDefault();
          togglePlay();
          break;
        case "step-commit":
          e.preventDefault();
          stepCommit(action.dir);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bounds.t1, onCursor, stepInteraction, stepCommit, togglePlay, selected, fitSelection, fitSession, zoomButtons]);

  const xOfClient = (clientX: number): number => {
    const inner = innerRef.current;
    return inner ? clientX - inner.getBoundingClientRect().left : 0;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".rl-tl-playhead")) return;
    if ((e.target as HTMLElement).closest(".rl-tl-bar-hit")) return;
    if ((e.target as HTMLElement).closest(".rl-tl-int")) return;
    // Component lane owns its hits (+N more, bars, phase select) — scrubbing
    // here stole the gesture and fought the click handlers.
    if ((e.target as HTMLElement).closest(".rl-wf-packed")) return;
    if (e.altKey) return onSetAB({ ...ab, a: snapT(tOfClient(e.clientX)) });
    if (e.shiftKey) {
      // Ambiguous until movement: a still shift-click sets B (existing
      // behavior); dragging past the threshold becomes a zoom rubber band.
      bandAnchor.current = { clientX: e.clientX, pointerId: e.pointerId };
      innerRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    scrubbing.current = true;
    innerRef.current?.setPointerCapture(e.pointerId);
    scrubToClient(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (bandAnchor.current) {
      if (band || Math.abs(e.clientX - bandAnchor.current.clientX) > BAND_THRESHOLD_PX) {
        const x0 = xOfClient(bandAnchor.current.clientX);
        const x1 = xOfClient(e.clientX);
        setBand({ x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
      }
      return;
    }
    if (scrubbing.current || draggingPlayhead.current) scrubToClient(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (bandAnchor.current) {
      const anchor = bandAnchor.current;
      bandAnchor.current = null;
      if (band && band.x1 - band.x0 > BAND_THRESHOLD_PX) {
        setBand(null);
        fitRange(tOfX(band.x0), tOfX(band.x1));
      } else {
        setBand(null);
        onSetAB({ ...ab, b: snapT(tOfClient(anchor.clientX)) });
      }
      return;
    }
    void e;
    scrubbing.current = false;
    draggingPlayhead.current = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const viewportX = e.clientX - el.getBoundingClientRect().left;
      zoomTo((scale || fit) * (e.deltaY < 0 ? 1.2 : 0.8), viewportX);
      return;
    }
    // When the waterfall lane is actually scrollable (a phase is expanded), a
    // vertical wheel over it belongs to the lane entirely — including edges,
    // where falling through to pan used to jump the view sideways. A collapsed
    // lane fits its viewport exactly, so the wheel pans as everywhere else.
    const lane = (e.target as HTMLElement).closest?.(".rl-wf-packed");
    if (
      lane &&
      lane.scrollHeight > lane.clientHeight + 1 &&
      Math.abs(e.deltaY) >= Math.abs(e.deltaX)
    ) {
      return;
    }
    el.scrollLeft += e.deltaX || e.deltaY;
  };

  // Non-passive wheel for preventDefault on ctrl-zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [collapsed, interactions.length]);

  const live = cursor.mode === "live";
  const cursorT = live ? bounds.t1 : cursor.t;
  const restoreStatus = travel?.on && !live ? (travel.status ?? null) : null;
  // Offline playback: without a live page to restore (imported session, or no
  // dev-build override API), show the captured page DOM at the cursor instead.
  const offlineDom =
    !live && (offline || !travel || !travel.supported) ? store.commitDomAt(cursorT) : undefined;
  const restoreFailures: RestoreFailureItem[] = restoreStatus
    ? [...restoreStatus.failedIds].map(([id, reason]) => ({
        id,
        name: store.instance(id)?.name ?? `#${id}`,
        reason,
      }))
    : [];
  const cursorCommit = store.commitAt(cursorT);
  const cursorAnomaly = cursorCommit && anomaly.isAnomaly(cursorCommit) ? cursorCommit : null;
  const cursorX = xOf(cursorT);
  const ticks = useMemo(() => buildTicks(model.segs, bounds.t0), [model.segs, bounds.t0]);
  const abComparison = useMemo(
    () =>
      ab.a !== undefined && ab.b !== undefined ? compareApplySets(store, ab.a, ab.b) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, ab.a, ab.b, version],
  );

  return (
    <div
      ref={rootRef}
      className={`rl-tl ${collapsed ? "rl-tl-collapsed" : "rl-tl-open"}`}
      style={{ ["--rl-tl-wf-h" as string]: `${paneH}px` }}
    >
      {!collapsed && (
        <div
          className="rl-tl-resize"
          title="Drag to resize the timeline"
          onPointerDown={(e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startH = paneH;
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => {
              // Dragging up grows the pane (the timeline docks at the bottom).
              const next = clampPaneHeight(startH + (startY - ev.clientY));
              rootRef.current?.style.setProperty("--rl-tl-wf-h", `${next}px`);
            };
            const up = (ev: PointerEvent) => {
              el.removeEventListener("pointermove", move);
              el.removeEventListener("pointerup", up);
              setPaneH(startH + (startY - ev.clientY));
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", up);
          }}
        />
      )}
      <div className="rl-tl-head">
        <button
          className="rl-icon-btn rl-tl-toggle"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Show timeline (T)" : "Collapse timeline (T)"}
          aria-label="Toggle timeline (T)"
        >
          {collapsed ? <IconChevronRight size={18} /> : <IconChevronDown size={18} />}
        </button>
        <span className="rl-tl-sub">
          {interactions.length} interactions · {commits.length} commits
        </span>
        <span className="rl-spacer" />
        {abComparison && (
          <>
            <button
              className={`rl-btn rl-tl-ab-btn${abPanelOpen ? " primary" : ""}`}
              onClick={() => setAbPanelOpen((v) => !v)}
              title="What changed between the A and B marks"
              aria-pressed={abPanelOpen}
            >
              A→B · {abComparison.changed.length} changed
            </button>
            <button
              className="rl-icon-btn"
              onClick={() => {
                onSetAB({});
                setAbPanelOpen(false);
              }}
              title="Clear A/B comparison"
              aria-label="Clear A/B comparison"
            >
              <IconClose size={12} />
            </button>
          </>
        )}
        <div className="rl-tl-nav">
          <button
            className="rl-icon-btn"
            onClick={() => stepInteraction(-1)}
            title="Previous interaction ([)"
            aria-label="Previous interaction ([)"
          >
            <IconSkipBack size={13} />
          </button>
          <button
            className={`rl-icon-btn${playing ? " active" : ""}`}
            onClick={togglePlay}
            title={playing ? "Pause (Space)" : "Play from playhead (Space)"}
            aria-label={playing ? "Pause" : "Play from playhead"}
          >
            {playing ? <IconPause size={12} /> : <IconPlay size={12} />}
          </button>
          <button
            className="rl-icon-btn"
            onClick={() => stepInteraction(1)}
            title="Next interaction (])"
            aria-label="Next interaction (])"
          >
            <IconSkipForward size={13} />
          </button>
          {travel && (
            <button
              className={`rl-icon-btn rl-tl-travel${travel.on ? " active" : ""}`}
              onClick={travel.toggle}
              disabled={!travel.supported}
              title={
                offline
                  ? "Imported session — time travel needs the original live page; showing captured page snapshots instead. Resume recording to go back live."
                  : !travel.supported
                    ? "Time travel requires a development React build"
                    : travel.on
                      ? "Time travel on — the page follows the playhead"
                      : "Time travel off — scrubbing only moves the panel views"
              }
              aria-label="Apply state to the page while scrubbing"
              aria-pressed={travel.on}
            >
              <IconRewind size={13} />
            </button>
          )}
          {restoreStatus && (
            <RestoreStatusPill
              applied={restoreStatus.applied}
              failures={restoreFailures}
              {...(onSelectComponent ? { onSelect: onSelectComponent } : {})}
            />
          )}
          <span className="rl-zoom-sep" />
          <button
            className="rl-icon-btn"
            onClick={() => zoomButtons(0.8)}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <IconMinus size={13} />
          </button>
          <button
            className="rl-icon-btn"
            onClick={() => zoomButtons(1.25)}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <IconPlus size={13} />
          </button>
          <button
            className={`rl-icon-btn${scale === 0 ? " active" : ""}`}
            onClick={fitSession}
            title="Fit session to width (F)"
            aria-label="Fit session to width"
          >
            <IconFitWidth size={13} />
          </button>
          <button
            className="rl-icon-btn"
            onClick={() => selected && fitSelection(selected)}
            disabled={!selected}
            title={selected ? "Fit selection (F)" : "Select an interaction to fit"}
            aria-label={selected ? "Fit selection" : "Fit selection (none selected)"}
          >
            <IconFitSelection size={13} />
          </button>
        </div>
        <button
          className={`rl-tl-live ${live ? "live" : "past"}`}
          onClick={() => onCursor({ t: bounds.t1, mode: "live" })}
          title={live ? "Following live" : "Return to live (L)"}
        >
          <span className="rl-tl-live-dot" />
          <span className="rl-tl-live-label">
            {live ? "LIVE" : `PAST · ${timeAxis(cursorT - bounds.t0)}`}
          </span>
        </button>
      </div>

      {!collapsed && interactions.length > 0 && innerWidth + INNER_RIGHT_PAD > viewW * 1.2 && (
        <Minimap
          interactions={interactions}
          commits={commits}
          anomaly={anomaly}
          bounds={bounds}
          onRegister={(ctl) => {
            minimapCtl.current = ctl;
            // Position the window as soon as the minimap mounts.
            if (ctl) syncScrollUi();
          }}
          onFitRange={fitRange}
          onSeekView={(t) => {
            const el = scrollRef.current;
            if (el) el.scrollLeft = Math.max(0, xOf(clamp(t, bounds.t0, bounds.t1)) - viewW / 2);
          }}
        />
      )}
      {!collapsed &&
        (interactions.length === 0 ? (
          <div className="rl-tl-empty">No activity yet — interact with the page.</div>
        ) : (
          <div className="rl-tl-body">
            <div className="rl-tl-labels">
              <div className="rl-tl-label rl-tl-label-ruler" />
              <div className="rl-tl-label" title="Interactions">
                <span className="rl-tl-label-full">Interact</span>
                <span className="rl-tl-label-short">Ixn</span>
              </div>
              <div className="rl-tl-label" title="Commits">
                <span className="rl-tl-label-full">Commits</span>
                <span className="rl-tl-label-short">Cmt</span>
              </div>
              <div className="rl-tl-label rl-tl-label-wf" title="Components">
                <span className="rl-tl-label-full">Comps</span>
                <span className="rl-tl-label-short">Cmp</span>
              </div>
            </div>
            <div className="rl-tl-scroll" ref={scrollRef} onWheel={onWheel}>
              <div
                className="rl-tl-inner"
                ref={innerRef}
                // Right pad: min-width boxes and floated labels at the session
                // end must never crop against the scroll edge.
                style={{ width: Math.max(innerWidth + INNER_RIGHT_PAD, viewW) }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {/* Time ruler */}
                <div className="rl-tl-ruler">
                  {ticks.map((tick, i) => (
                    <span
                      key={i}
                      className={`rl-tl-tick${tick.major ? " major" : ""}`}
                      style={{ left: tick.x }}
                    >
                      {tick.major && tick.label && (
                        <span className="rl-tl-tick-label">{tick.label}</span>
                      )}
                    </span>
                  ))}
                </div>

                {/* Interactions track */}
                <div className="rl-tl-track rl-tl-track-int">
                  {interactions.map((it, i) => {
                    const c = intColor(it, i);
                    const kindClass =
                      it.kind === "load"
                        ? " rl-tl-int-load"
                        : it.kind === "system"
                          ? " rl-tl-int-system"
                          : it.kind === "click" || it.kind === "submit"
                            ? ` rl-tl-int-${it.kind}`
                            : "";
                    return (
                      <button
                        key={it.id}
                        className={`rl-tl-int${selectedId === it.id ? " sel" : ""}${kindClass}`}
                        style={{
                          left: xOf(it.start),
                          width: Math.max(3, xOf(it.end) - xOf(it.start)),
                          background: `rgba(${c},0.1)`,
                          borderColor: `rgba(${c},0.28)`,
                          ["--bar-left" as string]: `${xOf(it.start)}px`,
                          ["--bar-shift-max" as string]: `${Math.max(
                            0,
                            Math.max(3, xOf(it.end) - xOf(it.start)) - 56,
                          )}px`,
                        }}
                        title={`${it.label} · ${ms(it.metrics.totalDuration)} · ${it.metrics.renderCount} renders`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (selectedId === it.id) {
                            setSelectedId(null);
                            return;
                          }
                          setSelectedId(it.id);
                          onCursor({ t: it.start, mode: "historical" });
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          fitSelection(it);
                        }}
                      >
                        {/* Sticky shift is pure CSS from --rl-scroll-x (see theme.css). */}
                        <span className="rl-tl-int-label">{it.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Commits / heat track */}
                <div className="rl-tl-track rl-tl-track-react">
                  {commits.map((c) => {
                    const h = 6 + heatScale(c.totalSelfTime, anomaly.max) * (paneH >= 200 ? 28 : 18);
                    const bad = anomaly.isAnomaly(c);
                    const barW = Math.max(3, Math.min(10, 2 + heatScale(c.totalSelfTime, anomaly.max) * 8));
                    return (
                      <button
                        key={c.commitId}
                        type="button"
                        className={`rl-tl-bar-hit${bad ? " anomaly" : ""}`}
                        style={{ left: xOf(c.timestamp) }}
                        title={`Commit · ${ms(c.totalSelfTime)} · ${c.componentIds.length} components`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onCursor({ t: c.timestamp, mode: "historical" });
                          const byId = c.interactionId
                            ? interactions.find((i) => String(i.id) === String(c.interactionId))
                            : undefined;
                          const byTime = interactions.find(
                            (i) => c.timestamp >= i.start && c.timestamp <= i.end,
                          );
                          setSelectedId(byId?.id ?? byTime?.id ?? null);
                        }}
                      >
                        <span
                          className={`rl-tl-bar${bad ? " anomaly" : ""}`}
                          style={{
                            height: h,
                            width: barW,
                            left: 5 - barW / 2,
                            background: heatColor(c.totalSelfTime),
                            boxShadow: `0 0 ${4 + heatScale(c.totalSelfTime, anomaly.max) * 10}px ${heatColor(c.totalSelfTime)}55`,
                          }}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Wall-clock component bars (aligned to the ruler) */}
                <div className="rl-tl-track rl-tl-track-wf">
                  <PhaseWaterfall
                    store={store}
                    causality={causality}
                    interactions={interactions}
                    selectedId={selectedId}
                    playheadT={cursorT}
                    maxRows={Math.max(3, Math.floor((paneH - PHASE_PAD_Y - 18) / TRACK_H))}
                    xOf={xOf}
                    px={px}
                    cull={chunks}
                    {...(restoreStatus ? { unrestorable: restoreStatus.failedIds } : {})}
                    onSelectComponent={onSelectComponent}
                    onHighlight={onHighlight}
                    selectedComponent={selectedComponent}
                    {...(onAskAI ? { onAskAI } : {})}
                    onSeek={(t) => onCursor({ t, mode: "historical" })}
                    onSelectInteraction={(id) => {
                      setSelectedId(id);
                      const it = interactions.find((i) => i.id === id);
                      if (it) onCursor({ t: it.start, mode: "historical" });
                    }}
                  />
                </div>

                {/* Idle gaps */}
                {model.segs
                  .filter((s) => s.idle)
                  .map((s, i) => (
                    <span
                      key={`idle${i}`}
                      className="rl-tl-idle"
                      style={{ left: s.x0, width: s.x1 - s.x0 }}
                      title={`${ms(s.t1 - s.t0)} idle`}
                    >
                      {compactGap(s.t1 - s.t0)}
                    </span>
                  ))}

                {/* Anomaly markers */}
                {commits
                  .filter((c) => anomaly.isAnomaly(c))
                  .map((c) => (
                    <span
                      key={`a${c.commitId}`}
                      className="rl-tl-anomaly"
                      style={{ left: xOf(c.timestamp) }}
                      title={`Extreme commit · ${ms(c.totalSelfTime)}`}
                    >
                      ⚠
                    </span>
                  ))}

                {/* A/B */}
                {ab.a !== undefined && ab.b !== undefined && (
                  <span
                    className="rl-tl-abband"
                    style={{
                      left: xOf(Math.min(ab.a, ab.b)),
                      width: Math.max(2, Math.abs(xOf(ab.b) - xOf(ab.a))),
                    }}
                    aria-hidden
                  />
                )}
                {ab.a !== undefined && (
                  <span className="rl-tl-mark a" style={{ left: xOf(ab.a) }} data-mark="A" />
                )}
                {ab.b !== undefined && (
                  <span className="rl-tl-mark b" style={{ left: xOf(ab.b) }} data-mark="B" />
                )}

                {/* Shift-drag zoom band */}
                {band && (
                  <span
                    className="rl-tl-rubber"
                    style={{ left: band.x0, width: band.x1 - band.x0 }}
                    aria-hidden
                  />
                )}

                {/* Playhead */}
                <div
                  className={`rl-tl-playhead${live ? " live" : ""}${!live && travel?.on ? " traveling" : ""}`}
                  style={{ left: cursorX }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    draggingPlayhead.current = true;
                    innerRef.current?.setPointerCapture(e.pointerId);
                    scrubToClient(e.clientX);
                  }}
                  title={timeAxis(cursorT - bounds.t0)}
                >
                  <span className="rl-tl-playhead-head" />
                  <span className="rl-tl-playhead-stem" />
                  <span className="rl-tl-playhead-time">{timeAxis(cursorT - bounds.t0)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

      {!collapsed && offlineDom && (
        <DomSnapshotView dom={offlineDom.dom} atOffsetMs={offlineDom.timestamp - bounds.t0} />
      )}

      {!collapsed && abPanelOpen && abComparison && ab.a !== undefined && ab.b !== undefined && (
        <ABDiffPanel
          store={store}
          comparison={abComparison}
          a={ab.a}
          b={ab.b}
          {...(onSelectComponent ? { onSelectComponent } : {})}
          onClose={() => setAbPanelOpen(false)}
        />
      )}

      {!collapsed && (selected || cursorAnomaly) && (
        <SelectionStrip
          store={store}
          interaction={selected}
          anomalyCommit={cursorAnomaly}
          anomaly={anomaly}
          causality={causality}
          onSelectComponent={onSelectComponent}
          onCursor={onCursor}
          explainToken={explainToken}
          {...(onAskAI ? { onAskAI } : {})}
        />
      )}
    </div>
  );
}

/**
 * Session overview strip shown when zoomed in past one viewport: linear time
 * (no gutter compression), interaction spans + anomaly ticks, and a draggable
 * window mirroring the visible range of the compressed scale below it.
 */
function Minimap({
  interactions,
  commits,
  anomaly,
  bounds,
  onRegister,
  onFitRange,
  onSeekView,
}: {
  interactions: Interaction[];
  commits: CommitSummary[];
  anomaly: AnomalyStats;
  bounds: { t0: number; t1: number };
  /**
   * Hands the parent an imperative window updater: the viewport rectangle
   * follows scroll via direct DOM writes (same pass as --rl-scroll-x), never
   * through a React render.
   */
  onRegister: (ctl: { update(viewStart: number, viewEnd: number): void } | null) => void;
  /** Edge-dragging the viewport window zooms to the adjusted range. */
  onFitRange: (start: number, end: number) => void;
  onSeekView: (t: number) => void;
}) {
  const span = Math.max(1, bounds.t1 - bounds.t0);
  const pct = (t: number) => `${clamp(((t - bounds.t0) / span) * 100, 0, 100)}%`;
  const dragging = useRef(false);
  const windowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const t0 = bounds.t0;
    onRegister({
      update(viewStart, viewEnd) {
        const el = windowRef.current;
        if (!el) return;
        el.style.left = `${clamp(((viewStart - t0) / span) * 100, 0, 100)}%`;
        el.style.width = `${clamp(((viewEnd - viewStart) / span) * 100, 1, 100)}%`;
      },
    });
    return () => onRegister(null);
  }, [bounds.t0, span, onRegister]);
  const seek = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    onSeekView(bounds.t0 + frac * span);
  };
  return (
    <div
      className="rl-tl-minimap"
      title="Session overview — drag to move the view"
      onPointerDown={(e) => {
        dragging.current = true;
        seek(e);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* synthetic/exotic pointers may have no capturable id */
        }
      }}
      onPointerMove={(e) => {
        if (dragging.current) seek(e);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
    >
      {interactions.map((it) => (
        <span
          key={it.id}
          className="rl-tl-mini-int"
          style={{
            left: pct(it.start),
            width: `${clamp(((it.end - it.start) / span) * 100, 0.4, 100)}%`,
          }}
        />
      ))}
      {commits.map((c) => (
        <span
          key={c.commitId}
          className={`rl-tl-mini-commit${anomaly.isAnomaly(c) ? " anomaly" : ""}`}
          style={{ left: pct(c.timestamp) }}
        />
      ))}
      <span
        ref={windowRef}
        className="rl-tl-mini-window"
        onPointerDown={(e) => {
          const el = windowRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const edge =
            e.clientX - rect.left <= 6 ? "left" : rect.right - e.clientX <= 6 ? "right" : null;
          // Body clicks/drags fall through to the container's pan gesture.
          if (!edge) return;
          e.stopPropagation();
          e.preventDefault();
          const host = el.parentElement!.getBoundingClientRect();
          const t0 = bounds.t0;
          const tAt = (clientX: number) =>
            t0 + clamp((clientX - host.left) / Math.max(1, host.width), 0, 1) * span;
          const fixedT = edge === "left" ? tAt(rect.right) : tAt(rect.left);
          let lastT = tAt(e.clientX);
          const preview = () => {
            const a = Math.min(fixedT, lastT);
            const b = Math.max(fixedT, lastT);
            el.style.left = `${clamp(((a - t0) / span) * 100, 0, 100)}%`;
            el.style.width = `${clamp(((b - a) / span) * 100, 0.5, 100)}%`;
          };
          const move = (ev: PointerEvent) => {
            lastT = tAt(ev.clientX);
            preview();
          };
          const up = () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            const a = Math.min(fixedT, lastT);
            const b = Math.max(fixedT, lastT);
            if (b - a > 0.5) onFitRange(a, b);
          };
          el.setPointerCapture(e.pointerId);
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
        }}
      />
    </div>
  );
}

function SelectionStrip({
  store,
  interaction,
  anomalyCommit,
  anomaly,
  causality,
  onSelectComponent,
  onCursor,
  explainToken,
  onAskAI,
}: {
  store: TraceStore;
  interaction: Interaction | null;
  anomalyCommit: CommitSummary | null;
  anomaly: AnomalyStats;
  causality: Causality;
  onSelectComponent?: (id: ComponentId) => void;
  onCursor: (c: TimeCursor) => void;
  explainToken: number;
  onAskAI?: (question: string) => void;
}) {
  const changed = useMemo(
    () => (interaction ? changedCount(interaction, causality) : null),
    [interaction, causality],
  );
  const [explainOpen, setExplainOpen] = useState(false);
  const narrative = useMemo(() => {
    if (!explainOpen || !interaction) return null;
    return explainInteraction(store, causality, interaction, {
      diagnose: (id) => diagnoseOne(store, causality, id),
    });
  }, [explainOpen, interaction, store, causality]);

  useEffect(() => {
    setExplainOpen(false);
  }, [interaction?.id]);

  useEffect(() => {
    if (explainToken > 0 && interaction) setExplainOpen(true);
  }, [explainToken, interaction]);

  const handleCitation = useCallback(
    (ref: LensRef) => {
      if (ref.kind === "component") {
        onSelectComponent?.(ref.id);
        return;
      }
      if (ref.kind === "doctor") {
        onSelectComponent?.(ref.componentId);
        return;
      }
      if (ref.kind === "render") {
        onSelectComponent?.(ref.componentId);
        const ev = store.getRender(ref.id);
        if (ev) onCursor({ t: ev.timestamp, mode: "historical" });
      }
    },
    [onSelectComponent, onCursor, store],
  );

  const handleNext = useCallback(
    (next: NarrativeNextClick) => {
      if (next.kind === "component") {
        onSelectComponent?.(next.id as ComponentId);
        return;
      }
      if (next.kind === "doctor" && next.componentId != null) {
        onSelectComponent?.(next.componentId);
        return;
      }
      if (next.kind === "render") {
        const id = next.id as RenderId;
        const ev = store.getRender(id);
        if (next.componentId) onSelectComponent?.(next.componentId);
        if (ev) onCursor({ t: ev.timestamp, mode: "historical" });
      }
    },
    [onSelectComponent, onCursor, store],
  );

  return (
    <>
      <div className="rl-tl-card">
        <div className="rl-tl-card-info">
          {interaction && (
            <div className="rl-tl-card-main">
              <span className="rl-tl-card-title" title={interaction.label}>
                {interaction.label}
              </span>
              <span className="rl-tl-card-metric">{ms(interaction.metrics.totalDuration)}</span>
              <span className="rl-tl-card-dim">React {ms(interaction.metrics.reactDuration)}</span>
              <span className="rl-tl-card-dim">{interaction.metrics.renderCount} renders</span>
              {changed !== null && changed.wasted > 0 && (
                <span className="rl-tl-card-warn">{changed.wasted} wasted</span>
              )}
            </div>
          )}
          {anomalyCommit && (
            <span
              className="rl-tl-card-anomaly"
              title={`${Math.round(anomalyCommit.totalSelfTime / Math.max(0.01, anomaly.p95))}× p95`}
            >
              ⚠ {ms(anomalyCommit.totalSelfTime)} · {anomalyCommit.componentIds.length} comps
            </span>
          )}
        </div>
        {(interaction || anomalyCommit) && (
          <div className="rl-tl-card-actions" role="toolbar" aria-label="Selection actions">
            {interaction && (
              <button
                className={`rl-btn${explainOpen ? " primary" : ""}`}
                onClick={() => setExplainOpen((v) => !v)}
                title="Explain this interaction (why it cost what it cost)"
                aria-pressed={explainOpen}
              >
                Explain
              </button>
            )}
            {onAskAI &&
              (anomalyCommit ? (
                <button
                  className="rl-btn rl-btn-ai"
                  onClick={() =>
                    onAskAI(
                      commitFixPrompt(
                        anomalyCommit.commitId as number,
                        anomalyCommit.totalSelfTime,
                        anomalyCommit.componentIds.length,
                      ),
                    )
                  }
                  title="Investigate this outlier commit and propose a fix"
                >
                  <IconSparkle size={11} /> Fix with AI
                </button>
              ) : interaction && interaction.metrics.reactDuration >= SLOW_SELF_MS ? (
                <button
                  className="rl-btn rl-btn-ai"
                  onClick={() =>
                    onAskAI(
                      `Interaction "${interaction.label}" [interaction:${interaction.id}] spent ${Math.round(interaction.metrics.reactDuration)}ms in React across ${interaction.metrics.renderCount} renders — find the bottleneck and propose a concrete fix.`,
                    )
                  }
                  title="Over the frame budget — investigate and fix with AI"
                >
                  <IconSparkle size={11} /> Fix with AI
                </button>
              ) : null)}
          </div>
        )}
      </div>
      {narrative && (
        <NarrativeCard
          narrative={narrative}
          onCitation={handleCitation}
          onNext={handleNext}
          onClose={() => setExplainOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Wall-clock component waterfall: one bar per render, placed at xOf(timestamp)
 * with width from self-duration on the same scale as the ruler. Overlapping
 * renders stack onto tracks. Interaction phase columns remain as background.
 */
function PhaseWaterfall({
  store,
  causality,
  interactions,
  selectedId,
  playheadT,
  maxRows,
  xOf,
  px,
  cull,
  unrestorable,
  onSelectComponent,
  onHighlight,
  selectedComponent = null,
  onSelectInteraction,
  onAskAI,
  onSeek,
}: {
  store: TraceStore;
  causality: Causality;
  interactions: Interaction[];
  selectedId: string | null;
  playheadT: number;
  /** Rows that fit the lane viewport — the collapsed canvas never exceeds it. */
  maxRows: number;
  xOf: (t: number) => number;
  /** Current px/ms — the packer's min-width epsilon. */
  px: number;
  /** Horizontal culling window (chunk-aligned) — bars outside skip the DOM. */
  cull: ChunkRange;
  /** While traveling: components whose state could not be restored. */
  unrestorable?: ReadonlyMap<ComponentId, unknown>;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  selectedComponent?: ComponentId | null;
  onSelectInteraction?: (id: string) => void;
  onAskAI?: (question: string) => void;
  onSeek?: (t: number) => void;
}) {
  const packed = useMemo(
    () => packPhaseBars(store, interactions, xOf, px),
    [store, interactions, xOf, px],
  );
  // LOD: runs of sub-2px neighbors merge into cluster bars instead of a cap.
  const lod = useMemo(() => aggregateBars(packed.bars), [packed]);
  // Wasted verdicts only for detail bars that survived LOD, capped.
  const wastedSet = useMemo(() => {
    const set = new Set<RenderId>();
    let checked = 0;
    for (const bar of lod.singles) {
      if (checked >= WHY_CAP) break;
      checked++;
      try {
        if (causality.why(bar.renderId).verdict === "no-observable-change") set.add(bar.renderId);
      } catch {
        /* ignore */
      }
    }
    return set;
  }, [lod, causality]);
  // Phases the user opened past the track cap (mount bursts pack ~60 deep).
  const [expandedPhases, setExpandedPhases] = useState<ReadonlySet<string>>(new Set());

  if (interactions.length === 0 || packed.bars.length === 0) {
    return <div className="rl-tl-wf-empty">No component activity yet</div>;
  }

  // Per-phase depth; overflowing phases give their LAST fitting row to the
  // +N-more chip so the collapsed canvas fits the lane exactly (no dead
  // scroll stub — the lane only becomes scrollable once a phase is expanded).
  const depthByPhase = new Map<string, number>();
  for (const bar of packed.bars) {
    depthByPhase.set(bar.phaseId, Math.max(depthByPhase.get(bar.phaseId) ?? 0, bar.track + 1));
  }
  const contentRows = (phaseId: string): number => {
    const depth = depthByPhase.get(phaseId) ?? 0;
    if (expandedPhases.has(phaseId) || depth <= maxRows) return depth;
    return maxRows - 1;
  };
  const chipFor = (phaseId: string): boolean => (depthByPhase.get(phaseId) ?? 0) > maxRows;
  const hiddenCount = (phaseId: string): number =>
    packed.bars.filter((b) => b.phaseId === phaseId && b.track >= maxRows - 1).length;
  const barVisible = (bar: PackedBar): boolean => bar.track < contentRows(bar.phaseId);
  const togglePhaseDepth = (phaseId: string) =>
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  const displayTracks = Math.max(
    1,
    ...packed.phases.map((p) => contentRows(p.id) + (chipFor(p.id) ? 1 : 0)),
  );

  // Bottom pad clears the outer horizontal scrollbar overlaying the lane.
  const canvasH = PHASE_PAD_Y + displayTracks * TRACK_H + 18;

  return (
    // The outer div is the vertical scroll viewport; the canvas carries the
    // real content height so deep track stacks scroll instead of clipping and
    // phase backgrounds span every bar, not just the first viewport-full.
    <div className="rl-wf-packed">
      <div className="rl-wf-canvas" style={{ height: canvasH }}>
        {packed.phases.map((phase) => {
          const selected = selectedId === phase.id;
          const dim = selectedId != null && !selected;
          return (
            <div
              key={phase.id}
              className={`rl-wf-phase${selected ? " sel" : ""}${dim ? " dim" : ""}`}
              style={{ left: phase.left, width: Math.max(8, phase.width) }}
              title={`${phase.label} · ${phase.renderCount} renders · ${phase.barCount} shown`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectInteraction?.(phase.id);
              }}
            >
              <div className="rl-wf-phase-rule" aria-hidden />
            </div>
          );
        })}

        {packed.phases.map((phase) => {
          if (!chipFor(phase.id)) return null;
          const hidden = hiddenCount(phase.id);
          const open = expandedPhases.has(phase.id);
          return (
            <button
              key={`more-${phase.id}`}
              type="button"
              className="rl-wf-more"
              style={{
                left: phase.left + 2,
                top: PHASE_PAD_Y + contentRows(phase.id) * TRACK_H,
                height: BAR_H,
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                togglePhaseDepth(phase.id);
              }}
              title={open ? "Collapse to the top rows" : `${hidden} more renders in ${phase.label}`}
            >
              {open ? "− show less" : `+${hidden} more`}
            </button>
          );
        })}

        {lod.clusters.map((cluster) => {
          if (cluster.track >= contentRows(cluster.phaseId)) return null;
          if (cluster.left + cluster.width < cull.x0 || cluster.left > cull.x1) return null;
          const dim = selectedId != null && selectedId !== cluster.phaseId;
          return (
            <button
              key={`cl-${cluster.phaseId}-${cluster.track}-${cluster.left}`}
              type="button"
              className={`rl-wf-cluster${dim ? " dim" : ""}`}
              style={{
                left: cluster.left,
                width: Math.max(cluster.width, 14),
                top: PHASE_PAD_Y + cluster.track * TRACK_H,
                height: BAR_H,
              }}
              title={`${cluster.count} renders · ${ms(cluster.self)} total · slowest ${cluster.name} · ${cluster.phaseLabel}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelectInteraction?.(cluster.phaseId);
                onSeek?.(cluster.t0);
              }}
            >
              ×{cluster.count}
            </button>
          );
        })}

        {lod.singles.map((bar) => {
          if (!barVisible(bar)) return null;
          if (bar.left + bar.width < cull.x0 || bar.left > cull.x1) return null;
          const underPlayhead = playheadT >= bar.t0 - 0.25 && playheadT <= bar.t1;
          const dim = selectedId != null && selectedId !== bar.phaseId;
          const noRewind = unrestorable?.has(bar.id) ?? false;
          const wasted = wastedSet.has(bar.renderId);
          const rgb = componentRgb(bar.id);
          const fillA = 0.07 + bar.heat * 0.1;
          const borderA = 0.22 + bar.heat * 0.12;
          const top = PHASE_PAD_Y + bar.track * TRACK_H;
          // Flame-chart labeling: inside when the box fits it, floated after
          // the box when the track has room, otherwise tooltip-only.
          const narrow = bar.width < LABEL_MIN_PX;
          const outsideLabel = narrow && bar.labelRoom >= OUT_LABEL_MIN_ROOM;
          return (
            <Fragment key={`${bar.phaseId}-${bar.renderId}`}>
              <button
                type="button"
                className={`rl-wf-bar${narrow ? " narrow" : ""}${wasted ? " wasted" : ""}${underPlayhead ? " under-playhead" : ""}${dim ? " dim" : ""}${noRewind ? " rl-wf-bar-norewind" : ""}`}
                style={{
                  left: bar.left,
                  width: bar.width,
                  top,
                  height: BAR_H,
                  ["--rl-wf-fill" as string]: `rgba(${rgb},${fillA})`,
                  ["--rl-wf-border" as string]: `rgba(${rgb},${borderA})`,
                  ["--rl-wf-tick" as string]: `rgba(${rgb},${0.32 + bar.heat * 0.28})`,
                  ["--bar-left" as string]: `${bar.left}px`,
                  ["--bar-shift-max" as string]: `${Math.max(0, bar.width - 56)}px`,
                }}
                title={`${bar.name} · ${ms(bar.self)} · ${bar.reason}${wasted ? " · no visible change" : ""} · ${bar.phaseLabel}`}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerEnter={() => onHighlight?.(bar.id)}
                onPointerLeave={() => onHighlight?.(selectedComponent ?? null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectInteraction?.(bar.phaseId);
                  onSelectComponent?.(bar.id);
                  onHighlight?.(bar.id);
                  onSeek?.(bar.t0);
                }}
              >
                {/* Sticky shift is pure CSS from --rl-scroll-x (see theme.css). */}
                {!narrow && <span className="rl-wf-bar-label">{bar.name}</span>}
                {bar.width >= 64 && <span className="rl-wf-bar-ms">{ms(bar.self)}</span>}
                {onAskAI && bar.self >= SLOW_SELF_MS && bar.width >= 34 && (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="rl-fix-ai rl-wf-fix"
                    title={`Over the frame budget (${ms(bar.self)}) — investigate and fix with AI`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskAI(renderFixPrompt(bar.name, bar.id as number, bar.renderId as number, bar.self));
                    }}
                  >
                    <IconSparkle size={10} />
                  </span>
                )}
              </button>
              {outsideLabel && (
                <span
                  className={`rl-wf-bar-out${dim ? " dim" : ""}`}
                  style={{
                    left: bar.left + bar.width + 5,
                    top,
                    height: BAR_H,
                    maxWidth: Math.min(bar.labelRoom, 220),
                  }}
                  aria-hidden
                >
                  {bar.name}
                  {bar.labelRoom >= 110 && <span className="rl-wf-bar-out-ms"> · {ms(bar.self)}</span>}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const PHASE_PAD_Y = 8;
const TRACK_H = 28;
const BAR_H = 22;
/** Below this box width the label moves outside the bar (flame-chart style). */
const LABEL_MIN_PX = 56;
/** Minimum free run on the track before an outside label is worth drawing. */
const OUT_LABEL_MIN_ROOM = 40;

function componentRgb(id: ComponentId): string {
  return PALETTE[Math.abs(Number(id)) % PALETTE.length]!;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Desaturated identity hues — Linear/Vercel quiet, not neon. */
const PALETTE = [
  "120,132,152", // slate
  "108,138,142", // muted teal
  "138,128,148", // mauve
  "148,136,118", // warm stone
  "112,142,132", // sage
  "148,126,128", // dusty rose
  "122,134,156", // soft periwinkle
  "132,138,126", // olive gray
];
function intColor(it: Interaction, i: number): string {
  if (it.kind === "load") return "130,138,150";
  if (it.kind === "system") return "110,118,130";
  return PALETTE[i % PALETTE.length]!;
}

function heatScale(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.log1p(value) / Math.log1p(max);
}

function heatColor(msVal: number): string {
  if (msVal < 1) return "rgb(74,222,128)";
  if (msVal < 5) return "rgb(251,191,36)";
  if (msVal < 16) return "rgb(251,146,60)";
  return "rgb(248,113,113)";
}

function sessionComponentIds(commits: CommitSummary[], fromT = -Infinity): ComponentId[] {
  const out: ComponentId[] = [];
  const seen = new Set<ComponentId>();
  for (const c of commits) {
    if (c.timestamp + 0.01 < fromT) continue;
    for (const id of c.componentIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

const CHANGED_CAP = 800;

function changedCount(interaction: Interaction, causality: Causality): { wasted: number } | null {
  let wasted = 0;
  let checked = 0;
  for (const renderId of interaction.renderIds) {
    if (checked >= CHANGED_CAP) break;
    checked++;
    try {
      if (causality.why(renderId).verdict === "no-observable-change") wasted++;
    } catch {
      /* ignore */
    }
  }
  return { wasted };
}
