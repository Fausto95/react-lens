/* oxlint-disable react/react-compiler -- imperative canvas/gesture state is intentional */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ComponentId } from "@reactlens/protocol";
import type { LaneControls } from "../../laneFilter.js";
import type { TimeCursor } from "../../timeCursor.js";
import type { Timeline as TimelineModel } from "../useTimeline.js";
import { clamp } from "../model/axis.js";
import { semanticZoomForPxPerMs } from "../model/semanticZoom.js";
import { geometryFromQueryResult } from "./geometryFromLayout.js";
import { createTimelineRenderer, type TimelineRendererClient } from "../timelineRendererClient.js";
import {
  drawBase,
  drawOverlay,
  ensureHatchPattern,
  type ClipRect,
  type TimelineViewMode,
} from "./draw.js";
import { hitTestClipRects } from "./hitTest.js";
import { NAME_W, VIEW_SPAN_MAX, VIEW_SPAN_MIN, nameWidthFor } from "./metrics.js";
import { readTimelineTheme } from "./timelineTheme.js";
import { WallStrip } from "./WallStrip.js";
import { Footer } from "./Footer.js";
import { clipCauseColor, type Clip } from "../model/lanes.js";

const MODE_LABELS: Array<[TimelineViewMode, string]> = [
  ["density", "Density"],
  ["events", "Events"],
  ["cost", "Cost"],
  ["causality", "Causality"],
];

function findClip(lanes: readonly { clips: readonly Clip[] }[], renderId: unknown): Clip | null {
  for (const lane of lanes) {
    for (const clip of lane.clips) {
      if (!clip.aggregate && clip.renderId === renderId) return clip;
    }
  }
  return null;
}

function indexByBand(clipRects: Map<string, ClipRect>): Map<number, ClipRect[]> {
  const bands = new Map<number, ClipRect[]>();
  const bandH = 28;
  for (const rect of clipRects.values()) {
    const first = Math.floor(rect.hit.y / bandH);
    const last = Math.floor((rect.hit.y + rect.hit.height) / bandH);
    for (let band = first; band <= last; band++) {
      const bucket = bands.get(band);
      if (bucket) bucket.push(rect);
      else bands.set(band, [rect]);
    }
  }
  return bands;
}

export function Timeline({
  model,
  cursor,
  onCursor,
  lanes: laneControls,
  onSelectComponent,
  onHighlight,
  transport,
}: {
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (c: TimeCursor) => void;
  lanes?: LaneControls;
  fixApplied?: boolean;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  transport?: ReactNode;
}) {
  const { state, dispatch, axis, bounds, layout, markers, arrows, lanes, commits } = model;
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<TimelineRendererClient | null>(null);
  const patternRef = useRef<CanvasPattern | null>(null);
  const clipRectsRef = useRef(new Map<string, ClipRect>());
  const hitBandsRef = useRef(new Map<number, ClipRect[]>());
  const snapEdgesRef = useRef<number[]>([]);
  const dragRef = useRef<
    | null
    | { kind: "scrub" }
    | { kind: "range"; start: number }
    | { kind: "pan"; x: number; a0: number }
  >(null);
  const playheadRef = useRef(cursor.mode === "live" ? bounds.t1 : cursor.t);
  const [viewMode, setViewMode] = useState<TimelineViewMode>("events");
  const hoverRef = useRef<string | null>(null);
  const [tip, setTip] = useState<{ clip: Clip; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ width: state.width, height: state.viewportHeight });

  if (!(state.playing && cursor.mode === "live")) {
    playheadRef.current = cursor.mode === "live" ? bounds.t1 : cursor.t;
  }

  const nameW = nameWidthFor(size.width || NAME_W);
  const plotW = Math.max(1, size.width - nameW);
  const span = Math.max(VIEW_SPAN_MIN, state.view.a1 - state.view.a0);
  const pxPerMs = plotW / span;
  const semantic = semanticZoomForPxPerMs(pxPerMs);
  const paintH = layout.paintH ?? layout.totalH;
  const stageScrollTop = layout.scrollTop ?? state.scrollTop;
  const themeRef = useRef(readTimelineTheme(null));
  themeRef.current = readTimelineTheme(rootRef.current?.closest(".rl-redesign") ?? null);

  const aToX = useCallback(
    (a: number) =>
      nameW + ((a - state.view.a0) / Math.max(1e-6, state.view.a1 - state.view.a0)) * plotW,
    [nameW, plotW, state.view.a0, state.view.a1],
  );
  const xToA = useCallback(
    (x: number) =>
      state.view.a0 + ((x - nameW) / Math.max(1, plotW)) * (state.view.a1 - state.view.a0),
    [nameW, plotW, state.view.a0, state.view.a1],
  );
  const wToX = useCallback((t: number) => aToX(axis.wallToAxis(t)), [aToX, axis]);
  const xToW = useCallback(
    (x: number) => axis.axisToWall(clamp(xToA(x), 0, axis.total)),
    [axis, xToA],
  );

  const installGeometry = useCallback((rects: Map<string, ClipRect>, edges: number[]) => {
    clipRectsRef.current = rects;
    hitBandsRef.current = indexByBand(rects);
    snapEdgesRef.current = edges;
  }, []);

  const paintOverlay = useCallback(
    (rects: Map<string, ClipRect> = clipRectsRef.current) => {
      const overlay = overlayRef.current;
      const ctx = overlay?.getContext("2d");
      if (!ctx) return;
      drawOverlay({
        ctx,
        stageW: size.width,
        totalH: paintH,
        nameW,
        clipRects: rects,
        edges: arrows,
        selectedRender: state.selectedRender,
        marquee: null,
        hoverId: hoverRef.current,
        ghostT: null,
        playheadT: playheadRef.current,
        wToX,
        dragging: dragRef.current != null,
        theme: themeRef.current,
        viewMode,
      });
    },
    [arrows, nameW, paintH, size.width, state.selectedRender, viewMode, wToX],
  );

  const paint = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    const theme = themeRef.current;
    const proj = { aToX, wToX, nameW, stageW: size.width, pxPerMs };
    const geometry = geometryFromQueryResult(model.timelineResult);
    const renderer = rendererRef.current;

    if (renderer) {
      renderer.paint(
        {
          axis: { segs: axis.segs, total: axis.total, w0: axis.w0, w1: axis.w1 },
          view: state.view,
          layout,
          ...(geometry.count ? { geometry } : {}),
          region: state.region,
          markers,
          selectedRender: state.selectedRender,
          nameW,
          stageW: size.width,
          pxPerMs,
          tOrigin: bounds.t0,
          theme,
          viewMode,
        },
        (rects, edges) => {
          installGeometry(rects, edges);
          paintOverlay(rects);
        },
      );
    } else {
      const bctx = base.getContext("2d");
      if (bctx) {
        if (!patternRef.current) patternRef.current = ensureHatchPattern(bctx);
        const result = drawBase({
          ctx: bctx,
          axis,
          view: state.view,
          layout,
          ...(geometry.count ? { geometry } : {}),
          region: state.region,
          markers,
          selectedRender: state.selectedRender,
          proj,
          pattern: patternRef.current,
          tOrigin: bounds.t0,
          theme,
          viewMode,
        });
        installGeometry(result.clipRects, result.snapEdges);
      }
    }

    paintOverlay();
  }, [
    aToX,
    axis,
    bounds.t0,
    installGeometry,
    layout,
    markers,
    model.timelineResult,
    nameW,
    paintOverlay,
    pxPerMs,
    size.width,
    state.region,
    state.selectedRender,
    state.view,
    viewMode,
    wToX,
  ]);

  useEffect(() => {
    const base = baseRef.current;
    if (!base || rendererRef.current) return;
    rendererRef.current = createTimelineRenderer(base);
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      dispatch({ type: "measure", width, viewportHeight: height, scrollTop: stage.scrollTop });
      const dpr = window.devicePixelRatio || 1;
      const base = baseRef.current;
      const over = overlayRef.current;
      if (base && !rendererRef.current) {
        base.width = Math.ceil(width * dpr);
        base.height = Math.ceil(paintH * dpr);
        base.style.width = `${width}px`;
        base.style.height = `${paintH}px`;
        base.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (over) {
        over.width = Math.ceil(width * dpr);
        over.height = Math.ceil(paintH * dpr);
        over.style.width = `${width}px`;
        over.style.height = `${paintH}px`;
        over.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      rendererRef.current?.resize(width, paintH, dpr);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  }, [dispatch, paintH]);

  useEffect(() => {
    const id = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(id);
  }, [paint]);

  const goLive = useCallback(() => {
    if (state.playing) dispatch({ type: "pause" });
    playheadRef.current = bounds.t1;
    onCursor({ mode: "live", t: bounds.t1 });
    requestAnimationFrame(() => paintOverlay());
  }, [bounds.t1, dispatch, onCursor, paintOverlay, state.playing]);

  useEffect(() => {
    if (!state.playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let next = playheadRef.current + dt * state.speed * state.playDir;
      if (state.region) {
        if (state.playDir > 0 && next > state.region.end) next = state.region.start;
        if (state.playDir < 0 && next < state.region.start) next = state.region.end;
      } else if (state.playDir > 0 && next >= bounds.t1) {
        playheadRef.current = bounds.t1;
        dispatch({ type: "pause" });
        onCursor({ mode: "live", t: bounds.t1 });
        return;
      } else if (state.playDir < 0 && next <= bounds.t0) {
        next = bounds.t0;
        dispatch({ type: "pause" });
      }
      playheadRef.current = next;
      onCursor({ mode: "historical", t: next });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bounds.t0, bounds.t1, dispatch, onCursor, state.playDir, state.playing, state.region, state.speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        dispatch(state.playing ? { type: "pause" } : { type: "play", dir: 1 });
      } else if (e.key.toLowerCase() === "f") {
        dispatch({ type: "fit" });
      } else if (e.key === "End" || e.key === ".") {
        goLive();
      } else if (e.key === "Escape") {
        dispatch({ type: "clearClip" });
        dispatch({ type: "setRegion", span: null });
      } else if (e.key === "1") setViewMode("density");
      else if (e.key === "2") setViewMode("events");
      else if (e.key === "3") setViewMode("cost");
      else if (e.key === "4") setViewMode("causality");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, goLive, state.playing]);

  const local = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const hitAt = (x: number, y: number) => {
    const band = Math.floor(y / 28);
    return hitTestClipRects({ x, y }, hitBandsRef.current.get(band) ?? []);
  };

  const inspect = (rect: ClipRect) => {
    dispatch({ type: "selectClip", renderId: rect.clip.renderId, laneKey: rect.clip.laneKey });
    onSelectComponent?.(rect.clip.componentId);
    onHighlight?.(rect.clip.componentId);
  };

  const nearestSnap = (t: number, x: number) => {
    let best = t;
    let bestD = 6;
    for (const edge of snapEdgesRef.current) {
      const d = Math.abs(wToX(edge) - x);
      if (d < bestD) {
        bestD = d;
        best = edge;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e.clientX, e.clientY);
    if (x < nameW) return;
    if (e.button === 1) {
      dragRef.current = { kind: "pan", x: e.clientX, a0: state.view.a0 };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.shiftKey) {
      const t = xToW(x);
      dispatch({ type: "setRegion", span: { start: t, end: t } });
      dragRef.current = { kind: "range", start: t };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const hit = hitAt(x, y);
    if (hit) {
      inspect(hit);
      return;
    }
    const t = nearestSnap(xToW(x), x);
    playheadRef.current = t;
    onCursor({ mode: "historical", t });
    dragRef.current = { kind: "scrub" };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e.clientX, e.clientY);
    const drag = dragRef.current;
    if (drag?.kind === "scrub") {
      const t = nearestSnap(xToW(x), x);
      playheadRef.current = t;
      onCursor({ mode: "historical", t });
      return;
    }
    if (drag?.kind === "range") {
      dispatch({ type: "setRegion", span: { start: drag.start, end: xToW(x) } });
      return;
    }
    if (drag?.kind === "pan") {
      const dx = e.clientX - drag.x;
      const dA = -(dx / Math.max(1, plotW)) * span;
      dispatch({ type: "setView", a0: drag.a0 + dA, span });
      return;
    }
    const hit = hitAt(x, y);
    const nextId = hit ? String(hit.clip.renderId) : null;
    if (nextId !== hoverRef.current) {
      hoverRef.current = nextId;
      onHighlight?.(hit?.clip.componentId ?? null);
      setTip(hit ? { clip: hit.clip, x: Math.min(size.width - 220, x + 14), y: y + 14 } : null);
      paintOverlay();
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // no capture
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const { x } = local(e.clientX, e.clientY);
    if (e.metaKey || e.ctrlKey) {
      const anchorA = clamp(xToA(x), 0, axis.total);
      dispatch({ type: "zoomBy", factor: e.deltaY > 0 ? 1.16 : 0.86, anchorA });
      return;
    }
    const dA = ((e.deltaX || e.deltaY) / Math.max(1, plotW)) * span;
    dispatch({ type: "panBy", dA });
  };

  const fit = () => dispatch({ type: "fit" });
  const zoomPercent = (() => {
    const maxSpan = Math.max(axis.total, VIEW_SPAN_MAX);
    const denom = Math.log(maxSpan) - Math.log(VIEW_SPAN_MIN);
    const p = denom <= 0 ? 1 : (Math.log(maxSpan) - Math.log(span)) / denom;
    return clamp(p * 100, 0, 100);
  })();
  const setZoomPercent = (p: number) => {
    const maxSpan = Math.max(axis.total, VIEW_SPAN_MAX);
    const nextSpan = Math.exp(
      Math.log(maxSpan) - (p / 100) * (Math.log(maxSpan) - Math.log(VIEW_SPAN_MIN)),
    );
    const center = (state.view.a0 + state.view.a1) / 2;
    dispatch({ type: "setView", a0: center - nextSpan / 2, span: nextSpan });
  };

  const stepCommit = (dir: -1 | 1) => {
    if (!commits.length) return;
    const t = playheadRef.current;
    const ordered = commits.map((c) => c.timestamp).sort((a, b) => a - b);
    const next =
      dir > 0
        ? ordered.find((x) => x > t + 0.001)
        : [...ordered].reverse().find((x) => x < t - 0.001);
    if (next != null) {
      playheadRef.current = next;
      onCursor({ mode: "historical", t: next });
    } else if (dir > 0) {
      goLive();
    }
  };

  const selection = state.selectedRender != null ? findClip(lanes, state.selectedRender) : null;
  const idleCollapsedMs = axis.segs.reduce(
    (sum, s) => (s.type === "gap" && s.a1 - s.a0 < 1e-6 ? sum + (s.w1 - s.w0) : sum),
    0,
  );

  return (
    <div ref={rootRef} className="tl tl-canvas-root">
      <div className="tl-toolbar">
        <div className="tl-toolbar-brand">
          <span className="tl-toolbar-lens" />
          Timeline
        </div>
        <button
          type="button"
          className="tl-btn"
          onClick={() => stepCommit(-1)}
          title="Previous commit"
        >
          ‹
        </button>
        <button
          type="button"
          className={`tl-btn${state.playing ? " on" : ""}`}
          onClick={() => dispatch(state.playing ? { type: "pause" } : { type: "play", dir: 1 })}
          title={state.playing ? "Pause (Space)" : "Play (Space)"}
        >
          {state.playing ? "⏸" : "▶"}
        </button>
        <button type="button" className="tl-btn" onClick={() => stepCommit(1)} title="Next commit">
          ›
        </button>
        <span
          style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-2)", minWidth: 72 }}
        >
          {(playheadRef.current - bounds.t0).toFixed(2)}ms
        </span>
        {cursor.mode === "historical" && (
          <button type="button" className="tl-btn on" onClick={goLive} title="Go live (End / .)">
            Live
          </button>
        )}
        {transport && (
          <>
            <span className="tl-toolbar-sep" />
            <span className="tl-toolbar-transport">{transport}</span>
          </>
        )}
        <span className="tl-toolbar-sep" />
        {MODE_LABELS.map(([mode, label], index) => (
          <button
            key={mode}
            type="button"
            className={`tl-btn${viewMode === mode ? " on" : ""}`}
            onClick={() => setViewMode(mode)}
            title={`${label} (${index + 1})`}
          >
            {label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--accent)",
            textTransform: "capitalize",
          }}
        >
          {semantic}
        </span>
        <button type="button" className="tl-btn" onClick={fit}>
          Fit
        </button>
        <span style={{ color: "var(--text-3)" }}>−</span>
        <input
          aria-label="Timeline zoom"
          type="range"
          min={0}
          max={100}
          value={zoomPercent}
          onChange={(e) => setZoomPercent(Number(e.currentTarget.value))}
          style={{ width: 110, accentColor: "var(--accent)" }}
        />
        <span style={{ color: "var(--text-3)" }}>+</span>
      </div>

      <WallStrip
        nameW={nameW}
        axis={axis}
        view={state.view}
        bounds={bounds}
        commits={commits}
        onView={(a0, nextSpan) => dispatch({ type: "setView", a0, span: nextSpan })}
      />

      <div
        ref={stageRef}
        className="tl-stage"
        style={{ touchAction: "none", position: "relative" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null;
          setTip(null);
          onHighlight?.(null);
          paintOverlay();
        }}
        onWheel={onWheel}
        onScroll={(e) =>
          dispatch({
            type: "setScroll",
            scrollTop: e.currentTarget.scrollTop,
            viewportHeight: e.currentTarget.clientHeight,
          })
        }
        onDoubleClick={(e) => {
          const { x, y } = local(e.clientX, e.clientY);
          const hit = hitAt(x, y);
          if (hit) {
            const a0 = axis.wallToAxis(hit.clip.t0);
            const a1 = axis.wallToAxis(hit.clip.t1);
            const nextSpan = Math.max(VIEW_SPAN_MIN, (a1 - a0) * 3);
            dispatch({ type: "setView", a0: (a0 + a1) / 2 - nextSpan / 2, span: nextSpan });
          } else {
            fit();
          }
        }}
      >
        <div className="tl-stage-spacer" style={{ height: layout.totalH }} />
        <canvas
          ref={baseRef}
          style={{
            position: "absolute",
            left: 0,
            top: stageScrollTop,
            display: "block",
            width: size.width,
            height: paintH,
          }}
        />
        <canvas
          ref={overlayRef}
          style={{
            position: "absolute",
            left: 0,
            top: stageScrollTop,
            pointerEvents: "none",
            width: size.width,
            height: paintH,
          }}
        />

        {layout.rows.map((row) => (
          <div
            key={row.key}
            className="tl-lname"
            style={{
              position: "absolute",
              left: 0,
              top: stageScrollTop + row.y,
              width: nameW - 1,
              height: row.h,
              color: row.dim ? "var(--text-3)" : "var(--text-2)",
              background:
                state.selectedLane === row.key
                  ? "color-mix(in srgb, var(--accent) 9%, var(--bg))"
                  : undefined,
              boxShadow: state.selectedLane === row.key ? "inset 2px 0 var(--accent)" : undefined,
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => dispatch({ type: "selectLane", laneKey: row.key })}
          >
            <span className="tl-lname-text">{row.lane.name}</span>
            {row.lane.instanceCount > 1 && (
              <span className="tl-lname-count">×{row.lane.instanceCount}</span>
            )}
            {row.mode === "stack" && row.depth > 1 && (
              <span className="tl-lname-count">▤×{Math.min(row.depth, 4)}</span>
            )}
            {laneControls && (
              <span className="tl-lname-acts">
                <span
                  className={`tl-ra${laneControls.filter.solo.has(row.key) ? " on" : ""}`}
                  title="Solo"
                  onClick={(e) => {
                    e.stopPropagation();
                    laneControls.toggleSolo(row.key);
                  }}
                >
                  S
                </span>
                <span
                  className={`tl-ra${laneControls.filter.muted.has(row.key) ? " on" : ""}`}
                  title="Mute"
                  onClick={(e) => {
                    e.stopPropagation();
                    laneControls.toggleMute(row.key);
                  }}
                >
                  M
                </span>
              </span>
            )}
          </div>
        ))}

        {tip && (
          <div
            className="tl-tip"
            style={{
              display: "block",
              left: tip.x,
              top: stageScrollTop + tip.y,
              pointerEvents: "none",
            }}
          >
            <div className="tl-tip-name">
              {tip.clip.name} #{tip.clip.componentId}
            </div>
            <div style={{ color: `var(--tl-clip-${clipCauseColor(tip.clip.cause)})` }}>
              {clipCauseColor(tip.clip.cause)}
              {tip.clip.wasted && <span style={{ color: "var(--warn)" }}> · wasted</span>}
            </div>
            <div className="tl-tip-meta">
              start {(tip.clip.t0 - bounds.t0).toFixed(2)}ms · duration {tip.clip.total.toFixed(2)}
              ms · self {tip.clip.self.toFixed(2)}ms
            </div>
          </div>
        )}
      </div>

      <Footer
        selection={selection}
        inScope={model.stats.renders}
        wastedN={model.stats.wasted}
        idleCollapsedMs={idleCollapsedMs}
        regionActive={state.region != null}
      />
    </div>
  );
}
