import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { TraceStore, Interaction, CommitSummary } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderId } from "@react-lens/protocol";
import { explainInteraction, type LensRef, type NarrativeNextClick } from "@react-lens/explain";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconMinus,
  IconPause,
  IconPlay,
  IconPlus,
  IconSkipBack,
  IconSkipForward,
} from "@react-lens/icons";
import { useTraceVersion } from "./useLens.js";
import { ms } from "@react-lens/ui";
import type { TimeCursor, ABMarks } from "./timeCursor.js";
import { NarrativeCard } from "./NarrativeCard.js";
import { diagnoseOne } from "./doctor.js";

type Mode = "collapsed" | "compact" | "expanded";
/** Open sizes always include the phase waterfall; collapsed hides the tracks. */
const NEXT_MODE: Record<Mode, Mode> = {
  collapsed: "compact",
  compact: "expanded",
  expanded: "collapsed",
};
const SNAP_PX = 6;
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
  onSelectComponent,
  onHighlight,
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
  onSelectComponent?: (id: ComponentId) => void;
  /** Highlight DOM hosts on the page (same as tree hover). */
  onHighlight?: (id: ComponentId | null) => void;
  /** Currently selected component — keeps page highlight sticky after a bar click. */
  selectedComponent?: ComponentId | null;
  /** Increment to open Explain for the current selection (⌘K). */
  explainToken?: number;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const interactions = useMemo(() => store.interactions(), [store, version]);
  const commits = useMemo(() => store.commits(), [store, version]);
  const [mode, setMode] = useState<Mode>("expanded");
  const [scale, setScale] = useState(0); // px/ms; 0 = auto-fit to viewport
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const draggingPlayhead = useRef(false);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);

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
  const fit = Math.max(0.02, (Math.max(240, viewW) - idleGutters * IDLE_WIDTH) / activeSpan);
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
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  }, []);

  const play = useCallback(
    (fromT: number, toT: number, loop = false) => {
      const segs = model.segs;
      const startX = projectX(segs, clamp(fromT, bounds.t0, bounds.t1));
      const endX = projectX(segs, clamp(toT, bounds.t0, bounds.t1));
      cancelAnimationFrame(rafRef.current);
      if (endX <= startX) {
        onCursor({ t: bounds.t1, mode: "live" });
        return;
      }
      const durMs = clamp((endX - startX) * 6, 700, 4000);
      let startWall = performance.now();
      setPlaying(true);
      const tick = () => {
        let frac = clamp((performance.now() - startWall) / durMs, 0, 1);
        if (frac >= 1 && loop) {
          startWall = performance.now();
          frac = 0;
        }
        const t = projectT(segs, startX + (endX - startX) * frac);
        const done = frac >= 1 && !loop;
        onCursor({ t, mode: done ? "live" : "historical" });
        if (!done) rafRef.current = requestAnimationFrame(tick);
        else setPlaying(false);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [model.segs, bounds.t0, bounds.t1, onCursor],
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

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
  }, [mode, interactions.length]);

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

  const fitSelection = useCallback(
    (it: Interaction) => {
      const span = Math.max(1, it.end - it.start);
      const target = clamp((Math.max(viewW, 400) * 0.75) / span, 0.01, 200);
      setScale(target);
      setSelectedId(it.id);
      onCursor({ t: it.start, mode: "historical" });
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollLeft = Math.max(0, xOf(it.start) - 40);
      });
    },
    [onCursor, xOf, viewW],
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      stop();
      return;
    }
    // Scrub forward from the playhead (or session start when live) and flash an update wave
    // for only the components that commit from that point onward.
    const from = cursor.mode === "historical" ? cursor.t : bounds.t0;
    const ids = sessionComponentIds(commits, from);
    if (ids.length > 0) onReplay?.(ids);
    play(from, bounds.t1, false);
  }, [playing, stop, play, cursor, bounds, commits, onReplay]);

  // Keyboard: T, L, [ ], Space, arrows
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") setMode((m) => NEXT_MODE[m]);
      else if (e.key === "l" || e.key === "L") onCursor({ t: bounds.t1, mode: "live" });
      else if (e.key === "[") stepInteraction(-1);
      else if (e.key === "]") stepInteraction(1);
      else if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        stepCommit(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        stepCommit(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bounds.t1, onCursor, stepInteraction, stepCommit, togglePlay]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".rl-tl-playhead")) return;
    if ((e.target as HTMLElement).closest(".rl-tl-bar-hit")) return;
    if ((e.target as HTMLElement).closest(".rl-tl-int")) return;
    if (e.altKey) return onSetAB({ ...ab, a: snapT(tOfClient(e.clientX)) });
    if (e.shiftKey) return onSetAB({ ...ab, b: snapT(tOfClient(e.clientX)) });
    scrubbing.current = true;
    innerRef.current?.setPointerCapture(e.pointerId);
    scrubToClient(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrubbing.current || draggingPlayhead.current) scrubToClient(e.clientX);
  };
  const onPointerUp = () => {
    scrubbing.current = false;
    draggingPlayhead.current = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const viewportX = e.clientX - el.getBoundingClientRect().left;
      const tAnchor = tOfX(el.scrollLeft + viewportX);
      const factor = e.deltaY < 0 ? 1.2 : 0.8;
      const next = clamp((scale || fit) * factor, 0.01, 200);
      setScale(next);
      requestAnimationFrame(() => {
        const newModel = buildScale(active, bounds.t0, bounds.t1, next);
        const newX = projectX(newModel.segs, clamp(tAnchor, bounds.t0, bounds.t1));
        el.scrollLeft = Math.max(0, newX - viewportX);
      });
    } else {
      el.scrollLeft += e.deltaX || e.deltaY;
    }
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
  }, [mode, interactions.length]);

  const live = cursor.mode === "live";
  const cursorT = live ? bounds.t1 : cursor.t;
  const cursorCommit = store.commitAt(cursorT);
  const cursorAnomaly = cursorCommit && anomaly.isAnomaly(cursorCommit) ? cursorCommit : null;
  const cursorX = xOf(cursorT);
  const ticks = useMemo(() => buildTicks(model.segs, bounds.t0), [model.segs, bounds.t0]);

  return (
    <div className={`rl-tl rl-tl-${mode}`}>
      <div className="rl-tl-head">
        <button
          className="rl-icon-btn rl-tl-toggle"
          onClick={() => setMode(NEXT_MODE[mode])}
          title={
            mode === "collapsed"
              ? "Show timeline (T)"
              : mode === "compact"
                ? "Expand phase waterfall (T)"
                : "Collapse timeline (T)"
          }
          aria-label="Cycle timeline size (T)"
        >
          {mode === "collapsed" ? <IconChevronRight size={18} /> : <IconChevronDown size={18} />}
        </button>
        <span className="rl-tl-sub">
          {interactions.length} interactions · {commits.length} commits
          {mode === "compact" && " · compact"}
        </span>
        <span className="rl-spacer" />
        {ab.a !== undefined && ab.b !== undefined && (
          <button
            className="rl-icon-btn"
            onClick={() => onSetAB({})}
            title="Clear A/B comparison"
            aria-label="Clear A/B comparison"
          >
            <IconClose size={12} />
          </button>
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
          <span className="rl-zoom-sep" />
          <button
            className="rl-icon-btn"
            onClick={() => setScale((s) => clamp((s || fit) * 0.8, 0.01, 200))}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <IconMinus size={13} />
          </button>
          <button
            className="rl-icon-btn"
            onClick={() => setScale((s) => clamp((s || fit) * 1.25, 0.01, 200))}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <IconPlus size={13} />
          </button>
          <button
            className={`rl-icon-btn${scale === 0 ? " active" : ""}`}
            onClick={() => setScale(0)}
            title="Fit session to width"
            aria-label="Fit session to width"
          >
            <span className="rl-tl-fit-glyph">⊡</span>
          </button>
          {selected && (
            <button
              className="rl-icon-btn"
              onClick={() => fitSelection(selected)}
              title="Fit selection"
              aria-label="Fit selection"
            >
              <span className="rl-tl-fit-glyph">⛶</span>
            </button>
          )}
        </div>
        <button
          className={`rl-tl-live ${live ? "live" : "past"}`}
          onClick={() => onCursor({ t: bounds.t1, mode: "live" })}
          title={live ? "Following live" : "Return to live (L)"}
        >
          <span className="rl-tl-live-dot" />
          <span className="rl-tl-live-label">
            {live ? "LIVE" : `PAST · ${ms(cursorT - bounds.t0)}`}
          </span>
        </button>
      </div>

      {mode !== "collapsed" &&
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
                style={{ width: Math.max(innerWidth, viewW) }}
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
                        <span className="rl-tl-int-label">{it.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Commits / heat track */}
                <div className="rl-tl-track rl-tl-track-react">
                  {commits.map((c) => {
                    const h = 6 + heatScale(c.totalSelfTime, anomaly.max) * (mode === "expanded" ? 28 : 18);
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

                {/* Phase-packed component bars (no persistent lanes) */}
                <div className="rl-tl-track rl-tl-track-wf">
                  <PhaseWaterfall
                    store={store}
                    causality={causality}
                    interactions={interactions}
                    selectedId={selectedId}
                    playheadT={cursorT}
                    xOf={xOf}
                    onSelectComponent={onSelectComponent}
                    onHighlight={onHighlight}
                    selectedComponent={selectedComponent}
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
                      ⋯
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
                {ab.a !== undefined && (
                  <span className="rl-tl-mark a" style={{ left: xOf(ab.a) }} data-mark="A" />
                )}
                {ab.b !== undefined && (
                  <span className="rl-tl-mark b" style={{ left: xOf(ab.b) }} data-mark="B" />
                )}

                {/* Playhead */}
                <div
                  className={`rl-tl-playhead${live ? " live" : ""}`}
                  style={{ left: cursorX }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    draggingPlayhead.current = true;
                    innerRef.current?.setPointerCapture(e.pointerId);
                    scrubToClient(e.clientX);
                  }}
                  title={ms(cursorT - bounds.t0)}
                >
                  <span className="rl-tl-playhead-head" />
                  <span className="rl-tl-playhead-stem" />
                  <span className="rl-tl-playhead-time">{ms(cursorT - bounds.t0)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

      {mode !== "collapsed" && (selected || cursorAnomaly) && (
        <SelectionStrip
          store={store}
          interaction={selected}
          anomalyCommit={cursorAnomaly}
          anomaly={anomaly}
          causality={causality}
          onSelectComponent={onSelectComponent}
          onCursor={onCursor}
          explainToken={explainToken}
        />
      )}
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
}: {
  store: TraceStore;
  interaction: Interaction | null;
  anomalyCommit: CommitSummary | null;
  anomaly: AnomalyStats;
  causality: Causality;
  onSelectComponent?: (id: ComponentId) => void;
  onCursor: (c: TimeCursor) => void;
  explainToken: number;
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
        {interaction && (
          <div className="rl-tl-card-actions" role="toolbar" aria-label="Selection actions">
            <button
              className={`rl-btn${explainOpen ? " primary" : ""}`}
              onClick={() => setExplainOpen((v) => !v)}
              title="Explain this interaction (why it cost what it cost)"
              aria-pressed={explainOpen}
            >
              Explain
            </button>
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
 * Phase-scoped packed waterfall: one column per interaction. Each bar is one
 * render (re-renders of the same component show as separate bars). Width is
 * cost-scaled inside the phase column; order follows render time.
 */
function PhaseWaterfall({
  store,
  causality,
  interactions,
  selectedId,
  playheadT,
  xOf,
  onSelectComponent,
  onHighlight,
  selectedComponent = null,
  onSelectInteraction,
  onSeek,
}: {
  store: TraceStore;
  causality: Causality;
  interactions: Interaction[];
  selectedId: string | null;
  playheadT: number;
  xOf: (t: number) => number;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  selectedComponent?: ComponentId | null;
  onSelectInteraction?: (id: string) => void;
  onSeek?: (t: number) => void;
}) {
  const packed = useMemo(
    () => packPhaseBars(store, causality, interactions, xOf),
    [store, causality, interactions, xOf],
  );

  if (interactions.length === 0 || packed.bars.length === 0) {
    return <div className="rl-tl-wf-empty">No component activity yet</div>;
  }

  const canvasH = PHASE_PAD_Y + packed.trackCount * TRACK_H + 6;

  return (
    <div className="rl-wf-packed" style={{ minHeight: canvasH }}>
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

      {packed.bars.map((bar) => {
        const underPlayhead = playheadT >= bar.t0 - 0.25 && playheadT <= bar.t1;
        const dim = selectedId != null && selectedId !== bar.phaseId;
        const rgb = componentRgb(bar.id);
        const fillA = 0.07 + bar.heat * 0.1;
        const borderA = 0.22 + bar.heat * 0.12;
        return (
          <button
            type="button"
            key={`${bar.phaseId}-${bar.renderId}`}
            className={`rl-wf-bar${bar.wasted ? " wasted" : ""}${underPlayhead ? " under-playhead" : ""}${dim ? " dim" : ""}`}
            style={{
              left: bar.left,
              width: bar.width,
              top: PHASE_PAD_Y + bar.track * TRACK_H,
              height: BAR_H,
              ["--rl-wf-fill" as string]: `rgba(${rgb},${fillA})`,
              ["--rl-wf-border" as string]: `rgba(${rgb},${borderA})`,
              ["--rl-wf-tick" as string]: `rgba(${rgb},${0.32 + bar.heat * 0.28})`,
            }}
            title={`${bar.name} · ${ms(bar.self)} · ${bar.reason}${bar.wasted ? " · no visible change" : ""} · ${bar.phaseLabel}`}
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
            <span className="rl-wf-bar-label">{bar.name}</span>
            {bar.width >= 64 && <span className="rl-wf-bar-ms">{ms(bar.self)}</span>}
          </button>
        );
      })}
    </div>
  );
}

const PHASE_PAD_Y = 8;
const TRACK_H = 28;
const BAR_H = 22;
const PHASE_BAR_CAP = 64;
/** Minimum readable bar width inside a phase column. */
const MIN_BAR_PX = 56;

interface PackedBar {
  id: ComponentId;
  renderId: RenderId;
  name: string;
  phaseId: string;
  phaseLabel: string;
  t0: number;
  t1: number;
  self: number;
  heat: number;
  wasted: boolean;
  reason: string;
  track: number;
  left: number;
  width: number;
}

interface PackedPhase {
  id: string;
  label: string;
  left: number;
  width: number;
  barCount: number;
  renderCount: number;
}

function packPhaseBars(
  store: TraceStore,
  causality: Causality,
  interactions: Interaction[],
  xOf: (t: number) => number,
): { phases: PackedPhase[]; bars: PackedBar[]; trackCount: number } {
  const phases: PackedPhase[] = [];
  const bars: PackedBar[] = [];
  let trackCount = 1;
  let whyChecked = 0;

  for (const it of interactions) {
    const phaseLeft = xOf(it.start);
    const phaseRight = xOf(Math.max(it.end, it.start + 0.05));
    const phaseWidth = Math.max(8, phaseRight - phaseLeft);

    type Agg = {
      id: ComponentId;
      renderId: RenderId;
      name: string;
      t0: number;
      t1: number;
      self: number;
      wasted: boolean;
      reason: string;
    };
    const items: Agg[] = [];

    for (const rid of it.renderIds) {
      const r = store.getRender(rid);
      if (!r) continue;
      const name = store.instance(r.componentId)?.name ?? `#${r.componentId}`;
      const t0 = r.timestamp;
      const t1 = r.timestamp + Math.max(r.selfDuration, 0.05);
      let wasted = false;
      if (whyChecked < WHY_CAP) {
        whyChecked++;
        try {
          wasted = causality.why(r.renderId).verdict === "no-observable-change";
        } catch {
          /* ignore */
        }
      }
      items.push({
        id: r.componentId,
        renderId: r.renderId,
        name,
        t0,
        t1,
        self: r.selfDuration,
        wasted,
        reason: r.reasons[0]?.type ?? "render",
      });
    }

    // One bar per render (re-renders stay visible), ranked by self-time.
    const ranked = [...items].sort((a, b) => b.self - a.self).slice(0, PHASE_BAR_CAP);

    phases.push({
      id: it.id,
      label: it.label,
      left: phaseLeft,
      width: phaseWidth,
      barCount: ranked.length,
      renderCount: items.length,
    });

    if (ranked.length === 0) continue;

    const maxSelf = Math.max(0, ...ranked.map((a) => a.self));
    const act0 = Math.min(...ranked.map((a) => a.t0));
    const act1 = Math.max(...ranked.map((a) => a.t1));
    const actSpan = Math.max(act1 - act0, 1e-6);

    const pad = Math.min(6, phaseWidth * 0.04);
    const innerW = Math.max(4, phaseWidth - pad * 2);
    const n = ranked.length;
    // Lone / sparse phases should use the column — don't leave a truncated chip
    // in a sea of empty track (zero-cost renders used to collapse to MIN_BAR_PX).
    const shareFloor =
      n === 1
        ? innerW * 0.92
        : Math.min(innerW, Math.max(MIN_BAR_PX, innerW / (n + 0.75)));

    const laid = ranked.map((item) => {
      const heat = maxSelf <= 0 ? 1 : item.self / maxSelf;
      const width = Math.min(innerW, Math.max(shareFloor, heat * innerW * 0.92));
      const rel = (item.t0 - act0) / actSpan;
      const maxLeft = innerW - width;
      const left = phaseLeft + pad + Math.max(0, Math.min(Math.max(0, maxLeft), rel * maxLeft));
      return {
        ...item,
        heat,
        left,
        width,
        pack0: left,
        pack1: left + width,
      };
    });

    const packedItems = greedyPack(
      laid.map((item) => ({ ...item, t0: item.pack0, t1: item.pack1 })),
    );
    for (const item of packedItems) {
      trackCount = Math.max(trackCount, item.track + 1);
      const real = ranked.find((r) => r.renderId === item.renderId)!;
      bars.push({
        id: item.id,
        renderId: item.renderId,
        name: item.name,
        phaseId: it.id,
        phaseLabel: it.label,
        t0: real.t0,
        t1: real.t1,
        self: item.self,
        heat: item.heat,
        wasted: item.wasted,
        reason: item.reason,
        track: item.track,
        left: item.left,
        width: item.width,
      });
    }
  }

  return { phases, bars, trackCount: Math.min(trackCount, 16) };
}

/** Assign non-overlapping tracks (greedy). Intervals are display px here. */
function greedyPack<T extends { t0: number; t1: number }>(
  items: T[],
): Array<T & { track: number }> {
  const sorted = [...items].sort(
    (a, b) => a.t0 - b.t0 || b.t1 - b.t0 - (a.t1 - a.t0),
  );
  const trackEnds: number[] = [];
  return sorted.map((item) => {
    let track = trackEnds.findIndex((end) => end <= item.t0 + 0.5);
    if (track < 0) {
      track = trackEnds.length;
      trackEnds.push(item.t1);
    } else {
      trackEnds[track] = item.t1;
    }
    return { ...item, track };
  });
}

function componentRgb(id: ComponentId): string {
  return PALETTE[Math.abs(Number(id)) % PALETTE.length]!;
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface AnomalyStats {
  median: number;
  p95: number;
  max: number;
  isAnomaly: (c: CommitSummary) => boolean;
}

function anomalyStats(commits: CommitSummary[]): AnomalyStats {
  const times = commits.map((c) => c.totalSelfTime).sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const p95 = percentile(times, 0.95);
  const max = times[times.length - 1] ?? 1;
  const floor = Math.max(8, median * 5);
  return { median, p95, max, isAnomaly: (c) => c.totalSelfTime >= floor && c.totalSelfTime >= p95 };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] ?? 0;
}

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

const IDLE_GAP_MS = 400;
const IDLE_WIDTH = 34;

interface Seg {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
  idle: boolean;
}
interface TimeScale {
  segs: Seg[];
  width: number;
}

function mergeActive(interactions: Interaction[]): Array<[number, number]> {
  const ivals = interactions
    .map((i) => [i.start, Math.max(i.end, i.start + 1)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of ivals) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] <= IDLE_GAP_MS) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function countIdleGutters(active: Array<[number, number]>, t0: number, t1: number): number {
  let n = 0;
  let cursor = t0;
  for (const [s, e] of active) {
    if (s > cursor) n++;
    cursor = e;
  }
  if (t1 > cursor) n++;
  return n;
}

function buildScale(
  active: Array<[number, number]>,
  t0: number,
  t1: number,
  px: number,
  /** When set (auto-fit), stretch so total width matches the viewport. */
  fillWidth?: number,
): TimeScale {
  const segs: Seg[] = [];
  let x = 0;
  let cursor = t0;
  const push = (a: number, b: number, w: number, idle: boolean) => {
    segs.push({ t0: a, t1: b, x0: x, x1: x + w, idle });
    x += w;
  };
  for (const [s, e] of active) {
    if (s > cursor) push(cursor, s, IDLE_WIDTH, true);
    push(s, e, Math.max(4, (e - s) * px), false);
    cursor = e;
  }
  if (t1 > cursor) push(cursor, t1, IDLE_WIDTH, true);
  if (segs.length === 0) push(t0, t1, Math.max(320, (t1 - t0) * px), false);

  // Auto-fit: if rounding/`Math.max(4, …)` left us short, pad the last active seg.
  if (fillWidth !== undefined && x < fillWidth && segs.length > 0) {
    const pad = fillWidth - x;
    let target = -1;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (!segs[i]!.idle) {
        target = i;
        break;
      }
    }
    if (target < 0) target = segs.length - 1;
    for (let i = target; i < segs.length; i++) {
      const s = segs[i]!;
      if (i === target) {
        s.x1 += pad;
      } else {
        s.x0 += pad;
        s.x1 += pad;
      }
    }
    x = fillWidth;
  }

  return { segs, width: fillWidth !== undefined ? Math.max(x, fillWidth) : Math.max(320, x) };
}

function projectX(segs: Seg[], t: number): number {
  for (const s of segs) {
    if (t <= s.t1) {
      const frac = s.t1 === s.t0 ? 0 : (t - s.t0) / (s.t1 - s.t0);
      return s.x0 + clamp(frac, 0, 1) * (s.x1 - s.x0);
    }
  }
  const last = segs[segs.length - 1];
  return last ? last.x1 : 0;
}

function projectT(segs: Seg[], x: number): number {
  for (const s of segs) {
    if (x <= s.x1) {
      const frac = s.x1 === s.x0 ? 0 : (x - s.x0) / (s.x1 - s.x0);
      return s.t0 + clamp(frac, 0, 1) * (s.t1 - s.t0);
    }
  }
  const last = segs[segs.length - 1];
  return last ? last.t1 : 0;
}

function sessionBounds(
  interactions: Interaction[],
  commits: CommitSummary[],
): { t0: number; t1: number; span: number } {
  let t0 = Infinity;
  let t1 = -Infinity;
  for (const it of interactions) {
    t0 = Math.min(t0, it.start);
    t1 = Math.max(t1, it.end);
  }
  for (const c of commits) {
    t0 = Math.min(t0, c.timestamp);
    t1 = Math.max(t1, c.timestamp);
  }
  if (!isFinite(t0)) {
    t0 = 0;
    t1 = 1;
  }
  return { t0, t1, span: Math.max(1, t1 - t0) };
}

function buildTicks(segs: Seg[], t0: number): Array<{ x: number; major: boolean; label: string }> {
  const ticks: Array<{ x: number; major: boolean; label: string }> = [];
  const active = segs.filter((s) => !s.idle);
  for (const s of active) {
    const span = s.t1 - s.t0;
    const pxSpan = Math.max(1, s.x1 - s.x0);
    // Aim for ~1 label per 56px so labels never collide.
    const targetSteps = Math.max(2, Math.floor(pxSpan / 56));
    const step = niceStep(span / targetSteps);
    let t = Math.ceil(s.t0 / step) * step;
    let lastLabelX = -Infinity;
    while (t <= s.t1 + 0.01) {
      const x = projectX(segs, t);
      const atEdge = Math.abs(t - s.t0) < 0.01 || Math.abs(t - s.t1) < 0.01;
      const major = atEdge || Math.abs((t - t0) % (step * 2)) < step * 0.01;
      const showLabel = major && (atEdge || x - lastLabelX >= 48);
      ticks.push({ x, major, label: showLabel ? ms(t - t0) : "" });
      if (showLabel) lastLabelX = x;
      t += step;
    }
  }
  return ticks;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n < 1.5) return pow;
  if (n < 3.5) return 2 * pow;
  if (n < 7.5) return 5 * pow;
  return 10 * pow;
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

function nearest(interactions: Interaction[], t: number): Interaction | null {
  let best: Interaction | null = null;
  let dist = Infinity;
  for (const it of interactions) {
    const d = t < it.start ? it.start - t : t > it.end ? t - it.end : 0;
    if (d < dist) {
      dist = d;
      best = it;
    }
  }
  return best;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Chronological unique component ids across commits from `fromT` onward. */
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
