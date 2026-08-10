import { useMemo, useRef, useState, useEffect } from "react";
import type { TraceStore, Interaction, CommitSummary } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "@react-lens/ui";
import type { TimeCursor, ABMarks } from "./timeCursor.js";

type Mode = "collapsed" | "compact" | "expanded";
const NEXT_MODE: Record<Mode, Mode> = { collapsed: "compact", compact: "expanded", expanded: "collapsed" };

/**
 * Interaction-first time machine (redesign §1-6, §160-165). The primary unit is
 * the interaction, not the commit; a shared time cursor scrubs the whole
 * product's history, A/B marks turn any two moments into a diff, and anomaly
 * markers surface the extreme commits automatically. DOM-rendered on a
 * time-proportional scale (Canvas/worker-LOD is a later phase).
 */
export function Timeline({
  store,
  causality,
  cursor,
  ab,
  onCursor,
  onSetAB,
  onReplay,
}: {
  store: TraceStore;
  causality: Causality;
  cursor: TimeCursor;
  ab: ABMarks;
  onCursor: (c: TimeCursor) => void;
  onSetAB: (ab: ABMarks) => void;
  onReplay?: (ids: ComponentId[]) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const interactions = useMemo(() => store.interactions(), [store, version]);
  const commits = useMemo(() => store.commits(), [store, version]);
  const [mode, setMode] = useState<Mode>("compact");
  const [scale, setScale] = useState(0); // px/ms; 0 = auto-fit
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);

  const bounds = useMemo(() => sessionBounds(interactions, commits), [interactions, commits]);
  const anomaly = useMemo(() => anomalyStats(commits), [commits]);

  // Idle time between interactions is compressed (redesign §149) so a long
  // pause doesn't push activity to opposite ends of an empty track. Time stays
  // linear WITHIN active regions; only the dead space collapses, marked with ⋯.
  const active = useMemo(() => mergeActive(interactions), [interactions]);
  const activeSpan = useMemo(() => active.reduce((s, [a, b]) => s + (b - a), 0) || 1, [active]);
  const fit = clamp(760 / activeSpan, 0.02, 4);
  const px = scale || fit;
  const model = useMemo(() => buildScale(active, bounds.t0, bounds.t1, px), [active, bounds, px]);
  const innerWidth = model.width;
  const xOf = (t: number) => projectX(model.segs, clamp(t, bounds.t0, bounds.t1));
  const tOf = (clientX: number) => {
    const inner = innerRef.current;
    if (!inner) return bounds.t0;
    const x = clamp(clientX - inner.getBoundingClientRect().left, 0, innerWidth);
    return projectT(model.segs, x);
  };

  // Play mode (redesign §106): advance the global cursor across the timeline
  // like a video playhead, so the Tree and Inspector replay history in motion.
  // Moves in screen-space (px) so compressed idle gaps whoosh by quickly.
  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setPlaying(false);
  };
  const play = (fromT: number, toT: number) => {
    const segs = model.segs;
    const startX = projectX(segs, clamp(fromT, bounds.t0, bounds.t1));
    const endX = projectX(segs, clamp(toT, bounds.t0, bounds.t1));
    cancelAnimationFrame(rafRef.current);
    if (endX <= startX) {
      onCursor({ t: bounds.t1, mode: "live" });
      return;
    }
    const durMs = clamp((endX - startX) * 6, 700, 4000);
    const startWall = performance.now();
    setPlaying(true);
    const tick = () => {
      const frac = clamp((performance.now() - startWall) / durMs, 0, 1);
      const t = projectT(segs, startX + (endX - startX) * frac);
      onCursor({ t, mode: frac >= 1 ? "live" : "historical" });
      if (frac < 1) rafRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const replayInteraction = (it: Interaction) => {
    onReplay?.(it.metrics.componentIds);
    play(it.start, it.end);
  };

  // Keyboard: T cycles mode, L returns live, [ ] jump interactions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "t" || e.key === "T") setMode((m) => NEXT_MODE[m]);
      else if (e.key === "l" || e.key === "L") onCursor({ t: bounds.t1, mode: "live" });
      else if (e.key === "[") stepInteraction(-1);
      else if (e.key === "]") stepInteraction(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactions, bounds.t1, cursor]);

  const stepInteraction = (dir: 1 | -1) => {
    if (interactions.length === 0) return;
    const here = cursor.mode === "historical" ? cursor.t : bounds.t1;
    const starts = interactions.map((i) => i.start);
    const next = dir > 0 ? starts.find((s) => s > here + 0.01) : [...starts].reverse().find((s) => s < here - 0.01);
    if (next !== undefined) {
      onCursor({ t: next, mode: "historical" });
      selectAt(next);
    }
  };

  const selectAt = (t: number) => {
    const hit = interactions.find((i) => t >= i.start && t <= i.end) ?? nearest(interactions, t);
    setSelectedId(hit?.id ?? null);
  };

  const scrubTo = (clientX: number) => {
    const t = tOf(clientX);
    onCursor({ t, mode: t >= bounds.t1 - 0.5 ? "live" : "historical" });
    selectAt(t);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.altKey) return onSetAB({ ...ab, a: tOf(e.clientX) });
    if (e.shiftKey) return onSetAB({ ...ab, b: tOf(e.clientX) });
    scrubbing.current = true;
    innerRef.current?.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrubbing.current) scrubTo(e.clientX);
  };
  const onPointerUp = () => {
    scrubbing.current = false;
  };

  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      setScale((s) => clamp((s || fit) * (e.deltaY < 0 ? 1.2 : 0.8), 0.01, 8));
    } else {
      el.scrollLeft += e.deltaX || e.deltaY;
    }
  };

  const selected = interactions.find((i) => i.id === selectedId) ?? null;
  const live = cursor.mode === "live";
  const cursorT = live ? bounds.t1 : cursor.t;
  const cursorCommit = store.commitAt(cursorT);
  const cursorAnomaly = cursorCommit && anomaly.isAnomaly(cursorCommit) ? cursorCommit : null;

  return (
    <div className={`rl-tl rl-tl-${mode}`}>
      <div className="rl-tl-head">
        <button className="rl-tl-mode" onClick={() => setMode(NEXT_MODE[mode])} title="Cycle size (T)">
          {mode === "collapsed" ? "▸" : mode === "compact" ? "▾" : "▿"} Timeline
        </button>
        <span className="rl-tl-sub">
          {interactions.length} interactions · {commits.length} commits
        </span>
        <span className="rl-spacer" />
        {ab.a !== undefined && ab.b !== undefined && (
          <button className="rl-tl-ab-clear" onClick={() => onSetAB({})} title="Clear A/B">
            A↔B ✕
          </button>
        )}
        <div className="rl-tl-nav">
          <button className="rl-zoom-btn" onClick={() => stepInteraction(-1)} title="Previous interaction ([)">|◀</button>
          <button
            className={`rl-zoom-btn${playing ? " active" : ""}`}
            onClick={() => (playing ? stop() : play(bounds.t0, bounds.t1))}
            title={playing ? "Pause" : "Replay whole timeline"}
          >
            {playing ? "⏸" : "▶"}
          </button>
          <button className="rl-zoom-btn" onClick={() => stepInteraction(1)} title="Next interaction (])">▶|</button>
          <span className="rl-zoom-sep" />
          <button className="rl-zoom-btn" onClick={() => setScale((s) => clamp((s || fit) * 0.8, 0.01, 8))} title="Zoom out">−</button>
          <button className="rl-zoom-btn" onClick={() => setScale((s) => clamp((s || fit) * 1.25, 0.01, 8))} title="Zoom in">+</button>
        </div>
        <button
          className={`rl-tl-live ${live ? "live" : "past"}`}
          onClick={() => onCursor({ t: bounds.t1, mode: "live" })}
          title={live ? "Following live" : "Return to live (L)"}
        >
          <span className="rl-tl-live-dot" />
          {live ? "LIVE" : `PAST · ${ms(cursorT - bounds.t0)}`}
        </button>
      </div>

      {mode !== "collapsed" && (
        interactions.length === 0 ? (
          <div className="rl-tl-empty">No activity yet — interact with the page.</div>
        ) : (
          <div className="rl-tl-scroll" ref={scrollRef} onWheel={onWheel}>
            <div
              className="rl-tl-inner"
              ref={innerRef}
              style={{ width: innerWidth }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* Interactions track */}
              <div className="rl-tl-track rl-tl-track-int">
                {interactions.map((it, i) => {
                  const c = intColor(it, i);
                  return (
                    <button
                      key={it.id}
                      className={`rl-tl-int${selectedId === it.id ? " sel" : ""}`}
                      style={{
                        left: xOf(it.start),
                        width: Math.max(3, (it.end - it.start) * px),
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
                    >
                      <span className="rl-tl-int-label">{it.label}</span>
                    </button>
                  );
                })}
              </div>

              {mode === "expanded" && (
                <div className="rl-tl-track rl-tl-track-state">
                  {stateMarkers(store, version).map((m, i) => (
                    <span key={i} className="rl-tl-state" style={{ left: xOf(m.t) }} title="state update" />
                  ))}
                </div>
              )}

              {/* React / heat track */}
              <div className="rl-tl-track rl-tl-track-react">
                {commits.map((c) => {
                  const h = 3 + heatScale(c.totalSelfTime, anomaly.max) * (mode === "expanded" ? 44 : 22);
                  const bad = anomaly.isAnomaly(c);
                  return (
                    <span
                      key={c.commitId}
                      className={`rl-tl-bar${bad ? " anomaly" : ""}`}
                      style={{ left: xOf(c.timestamp), height: h, background: heatColor(c.totalSelfTime) }}
                    />
                  );
                })}
              </div>

              {/* Collapsed idle gaps */}
              {model.segs.filter((s) => s.idle).map((s, i) => (
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
              {commits.filter((c) => anomaly.isAnomaly(c)).map((c) => (
                <span
                  key={`a${c.commitId}`}
                  className="rl-tl-anomaly"
                  style={{ left: xOf(c.timestamp) }}
                  title={`Extreme commit · ${ms(c.totalSelfTime)}`}
                >
                  ⚠
                </span>
              ))}

              {/* A/B markers */}
              {ab.a !== undefined && <span className="rl-tl-mark a" style={{ left: xOf(ab.a) }}>A</span>}
              {ab.b !== undefined && <span className="rl-tl-mark b" style={{ left: xOf(ab.b) }}>B</span>}

              {/* Cursor */}
              <span className={`rl-tl-cursor${live ? " live" : ""}`} style={{ left: xOf(cursorT) }} />
            </div>
          </div>
        )
      )}

      {mode === "expanded" && selected && (
        <RenderWaterfall store={store} interaction={selected} />
      )}

      {mode !== "collapsed" && (selected || cursorAnomaly) && (
        <SelectionCard
          interaction={selected}
          anomalyCommit={cursorAnomaly}
          anomaly={anomaly}
          causality={causality}
          ab={ab}
          onSetA={() => onSetAB({ ...ab, a: cursorT })}
          onSetB={() => onSetAB({ ...ab, b: cursorT })}
          onReplay={replayInteraction}
        />
      )}
    </div>
  );
}

function SelectionCard({
  interaction,
  anomalyCommit,
  anomaly,
  causality,
  ab,
  onSetA,
  onSetB,
  onReplay,
}: {
  interaction: Interaction | null;
  anomalyCommit: CommitSummary | null;
  anomaly: AnomalyStats;
  causality: Causality;
  ab: ABMarks;
  onSetA: () => void;
  onSetB: () => void;
  onReplay: (it: Interaction) => void;
}) {
  // Rendered-vs-Changed for the selected interaction (lazy, bounded).
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
            <span className="rl-tl-card-warn">{changed.wasted} no visible change</span>
          )}
          {interaction.metrics.stateUpdates > 0 && (
            <span className="rl-tl-card-dim">{interaction.metrics.stateUpdates} state</span>
          )}
        </div>
      )}
      {anomalyCommit && (
        <div className="rl-tl-card-anomaly">
          ⚠ Extreme commit · {ms(anomalyCommit.totalSelfTime)} ·{" "}
          {Math.round(anomalyCommit.totalSelfTime / Math.max(0.01, anomaly.p95))}× p95 ·{" "}
          {anomalyCommit.componentIds.length} rendered
        </div>
      )}
      <span className="rl-spacer" />
      <button className="rl-ctl" onClick={onSetA} title="Set comparison A at cursor">Set A</button>
      <button className="rl-ctl" onClick={onSetB} title="Set comparison B at cursor">Set B</button>
      {interaction && (
        <button className="rl-ctl rl-ctl-primary" onClick={() => onReplay(interaction)}>
          ▶ Replay
        </button>
      )}
      {ab.a !== undefined && ab.b !== undefined && (
        <span className="rl-tl-card-ab">Comparing A↔B in Inspector</span>
      )}
    </div>
  );
}

const WATERFALL_MAX = 120;

/**
 * Per-component render waterfall for the selected interaction (redesign §36):
 * each render is a bar positioned by when it happened within the interaction
 * and sized by its self-duration, revealing the propagation the single
 * interaction block hides. Ordered by time; capped so a huge mount stays cheap.
 */
function RenderWaterfall({ store, interaction }: { store: TraceStore; interaction: Interaction }) {
  const rows = useMemo(() => {
    const renders = interaction.renderIds
      .map((id) => store.getRender(id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.timestamp - b.timestamp);
    const span = Math.max(1, interaction.end - interaction.start);
    return renders.slice(0, WATERFALL_MAX).map((r) => ({
      name: store.instance(r.componentId)?.name ?? `#${r.componentId}`,
      leftPct: ((r.timestamp - interaction.start) / span) * 100,
      widthPct: Math.max(0.6, (r.selfDuration / span) * 100),
      self: r.selfDuration,
      total: renders.length,
    }));
  }, [store, interaction]);

  if (rows.length === 0) return null;
  const total = rows[0]!.total;

  return (
    <div className="rl-wf">
      <div className="rl-wf-head">
        {interaction.label} · {total} renders{total > WATERFALL_MAX ? ` · showing ${WATERFALL_MAX} by time` : ""}
      </div>
      <div className="rl-wf-rows">
        {rows.map((row, i) => (
          <div className="rl-wf-row" key={i} title={`${row.name} · ${ms(row.self)}`}>
            <span className="rl-wf-name">{row.name}</span>
            <span className="rl-wf-track">
              <span
                className="rl-wf-bar"
                style={{ left: `${row.leftPct}%`, width: `${row.widthPct}%`, background: heatColor(row.self) }}
              />
            </span>
          </div>
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
  // Extreme = well above the session's typical cost and not trivially small.
  const floor = Math.max(8, median * 5);
  return { median, p95, max, isAnomaly: (c) => c.totalSelfTime >= floor && c.totalSelfTime >= p95 };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] ?? 0;
}

/** Distinct-but-restrained accents so adjacent interactions are easy to tell apart. */
const PALETTE = [
  "167,139,250", "96,165,250", "52,211,153", "251,191,36",
  "244,114,182", "45,212,191", "251,146,60", "129,140,248",
];
function intColor(it: Interaction, i: number): string {
  if (it.kind === "load") return "148,163,184";
  if (it.kind === "system") return "100,116,139";
  return PALETTE[i % PALETTE.length]!;
}

/** Gaps between interactions longer than this collapse to a fixed width. */
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

/** Merge interaction spans, joining ones separated by less than a small gap. */
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

/**
 * Piecewise time→x map: active spans scale linearly by `px`; the idle gaps
 * between them collapse to a fixed `IDLE_WIDTH` so the track stays dense.
 */
function buildScale(active: Array<[number, number]>, t0: number, t1: number, px: number): TimeScale {
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
  return { segs, width: Math.max(320, x) };
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

function sessionBounds(interactions: Interaction[], commits: CommitSummary[]): { t0: number; t1: number; span: number } {
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

/** Log-scaled height fraction so one 4.4s commit doesn't flatten the 1ms ones. */
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

/** State-update markers for the expanded track. */
function stateMarkers(store: TraceStore, _version: number): Array<{ t: number }> {
  const marks: Array<{ t: number }> = [];
  for (const e of store.allEvents()) {
    if (e.type === "render" && e.reasons.some((r) => r.type === "state")) marks.push({ t: e.timestamp });
  }
  return marks;
}

const CHANGED_CAP = 800;

/** How many of an interaction's renders produced no observable change. */
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
