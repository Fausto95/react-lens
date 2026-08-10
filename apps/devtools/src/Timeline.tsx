import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { TraceStore, Interaction, CommitSummary } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId, RenderEvent } from "@react-lens/protocol";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconMarkA,
  IconMarkB,
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

type Mode = "collapsed" | "compact" | "expanded";
const NEXT_MODE: Record<Mode, Mode> = { collapsed: "compact", compact: "expanded", expanded: "collapsed" };
const SNAP_PX = 6;
const LANE_LABEL_W = 88;
const WATERFALL_MAX = 120;
const WHY_CAP = 80;

/**
 * Video-editor-style time machine: labeled lanes, real playhead, interactive
 * component waterfall, Premiere-like gestures. DOM-rendered (Canvas LOD later).
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
}: {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  ab: ABMarks;
  onCursor: (c: TimeCursor) => void;
  onSetAB: (ab: ABMarks) => void;
  onReplay?: (ids: ComponentId[]) => void;
  onSelectComponent?: (id: ComponentId) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const interactions = useMemo(() => store.interactions(), [store, version]);
  const commits = useMemo(() => store.commits(), [store, version]);
  const [mode, setMode] = useState<Mode>("compact");
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
    if (selected) {
      const from =
        cursor.mode === "historical" && cursor.t >= selected.start && cursor.t < selected.end - 0.5
          ? cursor.t
          : selected.start;
      play(from, selected.end, true);
    } else {
      const from = cursor.mode === "historical" ? cursor.t : bounds.t0;
      play(from, bounds.t1, false);
    }
  }, [playing, stop, selected, play, cursor, bounds]);

  const replayInteraction = (it: Interaction) => {
    onReplay?.(it.metrics.componentIds);
    play(it.start, it.end);
  };

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
          className="rl-icon-btn"
          onClick={() => setMode(NEXT_MODE[mode])}
          title="Cycle timeline size (T)"
          aria-label="Cycle timeline size (T)"
        >
          {mode === "collapsed" ? <IconChevronRight size={14} /> : <IconChevronDown size={14} />}
        </button>
        <span className="rl-tl-sub">
          {interactions.length} interactions · {commits.length} commits
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
            title={playing ? "Pause (Space)" : selected ? "Play selection (Space)" : "Play from playhead (Space)"}
            aria-label={playing ? "Pause" : "Play"}
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
            <div className="rl-tl-labels" style={{ width: LANE_LABEL_W }}>
              <div className="rl-tl-label rl-tl-label-ruler" />
              <div className="rl-tl-label">Interactions</div>
              <div className="rl-tl-label">Commits</div>
              {mode === "expanded" && <div className="rl-tl-label rl-tl-label-wf">Components</div>}
            </div>
            <div className="rl-tl-scroll" ref={scrollRef} onWheel={onWheel}>
              <div
                className="rl-tl-inner"
                ref={innerRef}
                style={{ width: innerWidth }}
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
                      {tick.major && <span className="rl-tl-tick-label">{tick.label}</span>}
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
                          background: `rgba(${c},0.16)`,
                          borderColor: `rgba(${c},0.55)`,
                          color: `rgb(${c})`,
                        }}
                        title={`${it.label} · ${ms(it.metrics.totalDuration)} · ${it.metrics.renderCount} renders`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
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
                    const h = 4 + heatScale(c.totalSelfTime, anomaly.max) * (mode === "expanded" ? 28 : 18);
                    const bad = anomaly.isAnomaly(c);
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
                          style={{ height: h, background: heatColor(c.totalSelfTime) }}
                        />
                      </button>
                    );
                  })}
                </div>

                {/* Component waterfall lane (expanded) */}
                {mode === "expanded" && (
                  <div className="rl-tl-track rl-tl-track-wf">
                    {selected ? (
                      <ComponentWaterfall
                        store={store}
                        causality={causality}
                        interaction={selected}
                        onSelectComponent={onSelectComponent}
                      />
                    ) : (
                      <div className="rl-tl-wf-empty">Select an interaction to see component costs</div>
                    )}
                  </div>
                )}

                {/* Compact peek */}
                {mode === "compact" && selected && (
                  <WaterfallPeek store={store} interaction={selected} />
                )}

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
                  <span className="rl-tl-mark a" style={{ left: xOf(ab.a) }}>
                    A
                  </span>
                )}
                {ab.b !== undefined && (
                  <span className="rl-tl-mark b" style={{ left: xOf(ab.b) }}>
                    B
                  </span>
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
          interaction={selected}
          anomalyCommit={cursorAnomaly}
          anomaly={anomaly}
          causality={causality}
          ab={ab}
          onSetA={() => onSetAB({ ...ab, a: cursorT })}
          onSetB={() => onSetAB({ ...ab, b: cursorT })}
          onReplay={replayInteraction}
          onFit={selected ? () => fitSelection(selected) : undefined}
        />
      )}
    </div>
  );
}

function SelectionStrip({
  interaction,
  anomalyCommit,
  anomaly,
  causality,
  ab,
  onSetA,
  onSetB,
  onReplay,
  onFit,
}: {
  interaction: Interaction | null;
  anomalyCommit: CommitSummary | null;
  anomaly: AnomalyStats;
  causality: Causality;
  ab: ABMarks;
  onSetA: () => void;
  onSetB: () => void;
  onReplay: (it: Interaction) => void;
  onFit?: () => void;
}) {
  const changed = useMemo(
    () => (interaction ? changedCount(interaction, causality) : null),
    [interaction, causality],
  );

  return (
    <div className="rl-tl-card">
      {interaction && (
        <div className="rl-tl-card-main">
          <span className="rl-tl-card-title">{interaction.label}</span>
          <span className="rl-tl-card-metric">{ms(interaction.metrics.totalDuration)}</span>
          <span className="rl-tl-card-dim">React {ms(interaction.metrics.reactDuration)}</span>
          <span className="rl-tl-card-dim">{interaction.metrics.renderCount} renders</span>
          {changed !== null && changed.wasted > 0 && (
            <span className="rl-tl-card-warn">{changed.wasted} wasted</span>
          )}
        </div>
      )}
      {anomalyCommit && (
        <span className="rl-tl-card-anomaly" title={`${Math.round(anomalyCommit.totalSelfTime / Math.max(0.01, anomaly.p95))}× p95`}>
          ⚠ {ms(anomalyCommit.totalSelfTime)} · {anomalyCommit.componentIds.length} comps
        </span>
      )}
      <span className="rl-spacer" />
      <button
        className={`rl-icon-btn mark-a${ab.a !== undefined ? " active" : ""}`}
        onClick={onSetA}
        title="Set comparison A at cursor"
        aria-label="Set comparison A at cursor"
      >
        <IconMarkA size={14} />
      </button>
      <button
        className={`rl-icon-btn mark-b${ab.b !== undefined ? " active" : ""}`}
        onClick={onSetB}
        title="Set comparison B at cursor"
        aria-label="Set comparison B at cursor"
      >
        <IconMarkB size={14} />
      </button>
      {onFit && (
        <button className="rl-icon-btn" onClick={onFit} title="Fit selection" aria-label="Fit selection">
          <span className="rl-tl-fit-glyph">⛶</span>
        </button>
      )}
      {interaction && (
        <button
          className="rl-icon-btn primary"
          onClick={() => onReplay(interaction)}
          title="Replay interaction"
          aria-label="Replay interaction"
        >
          <IconPlay size={12} />
        </button>
      )}
      {ab.a !== undefined && ab.b !== undefined && (
        <span className="rl-tl-card-ab">A↔B</span>
      )}
    </div>
  );
}

function WaterfallPeek({ store, interaction }: { store: TraceStore; interaction: Interaction }) {
  const top = useMemo(() => {
    const renders = interaction.renderIds
      .map((id) => store.getRender(id))
      .filter((r): r is RenderEvent => r != null)
      .sort((a, b) => b.selfDuration - a.selfDuration);
    const first = renders[0];
    if (!first) return null;
    return {
      name: store.instance(first.componentId)?.name ?? `#${first.componentId}`,
      self: first.selfDuration,
      n: renders.length,
    };
  }, [store, interaction]);
  if (!top) return null;
  return (
    <div className="rl-tl-wf-peek">
      {top.n} components · top {top.name} · {ms(top.self)}
    </div>
  );
}

/**
 * Cost-sorted render waterfall for the selected interaction. Slow work rises
 * to the top; click selects the component in the tree/inspector.
 */
function ComponentWaterfall({
  store,
  causality,
  interaction,
  onSelectComponent,
}: {
  store: TraceStore;
  causality: Causality;
  interaction: Interaction;
  onSelectComponent?: (id: ComponentId) => void;
}) {
  const rows = useMemo(() => {
    const renders = interaction.renderIds
      .map((id) => store.getRender(id))
      .filter((r): r is RenderEvent => r != null)
      .sort((a, b) => b.selfDuration - a.selfDuration)
      .slice(0, WATERFALL_MAX);
    const span = Math.max(1, interaction.end - interaction.start);
    const maxSelf = Math.max(1, ...renders.map((r) => r.selfDuration));
    let whyChecked = 0;
    return renders.map((r) => {
      let wasted = false;
      if (whyChecked < WHY_CAP) {
        whyChecked++;
        try {
          wasted = causality.why(r.renderId).verdict === "no-observable-change";
        } catch {
          /* ignore */
        }
      }
      const reason = r.reasons[0]?.type ?? "render";
      return {
        id: r.componentId,
        name: store.instance(r.componentId)?.name ?? `#${r.componentId}`,
        leftPct: ((r.timestamp - interaction.start) / span) * 100,
        widthPct: Math.max(0.8, (r.selfDuration / span) * 100),
        self: r.selfDuration,
        heat: r.selfDuration / maxSelf,
        wasted,
        reason,
      };
    });
  }, [store, causality, interaction]);

  if (rows.length === 0) {
    return <div className="rl-tl-wf-empty">No renders in this interaction</div>;
  }

  return (
    <div className="rl-wf rl-wf-lane">
      <div className="rl-wf-rows">
        {rows.map((row, i) => (
          <button
            type="button"
            className={`rl-wf-row${row.wasted ? " wasted" : ""}`}
            key={`${row.id}-${i}`}
            title={`${row.name} · ${ms(row.self)} · ${row.reason}${row.wasted ? " · no visible change" : ""}`}
            onClick={() => onSelectComponent?.(row.id)}
          >
            <span className="rl-wf-name">{row.name}</span>
            <span className="rl-wf-track">
              <span
                className="rl-wf-bar"
                style={{
                  left: `${row.leftPct}%`,
                  width: `${row.widthPct}%`,
                  background: heatColor(row.self),
                  opacity: 0.55 + row.heat * 0.45,
                }}
              />
            </span>
            <span className="rl-wf-ms">{ms(row.self)}</span>
          </button>
        ))}
      </div>
    </div>
  );
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

const PALETTE = [
  "167,139,250", "96,165,250", "52,211,153", "251,191,36",
  "244,114,182", "45,212,191", "251,146,60", "129,140,248",
];
function intColor(it: Interaction, i: number): string {
  if (it.kind === "load") return "148,163,184";
  if (it.kind === "system") return "100,116,139";
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
    const step = niceStep(span / 4);
    let t = Math.ceil(s.t0 / step) * step;
    while (t <= s.t1 + 0.01) {
      const x = projectX(segs, t);
      const major = Math.abs((t - t0) % (step * 2)) < step * 0.01 || Math.abs(t - s.t0) < 0.01;
      ticks.push({ x, major, label: ms(t - t0) });
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
