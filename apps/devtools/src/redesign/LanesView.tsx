import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentId, RenderId } from "@reactlens/protocol";
import { laneVisibility, type LaneControls, type LaneKey } from "../laneFilter.js";
import {
  clipCauseColor,
  type Clip,
  type DensityBucket,
  type Lane,
} from "../timeline/model/lanes.js";
import type { CausalEdge } from "../timeline/model/edges.js";

/**
 * The concept's lane grid: a fixed 148px name gutter per lane and a track
 * positioned in PERCENT of the current view window (no scroll canvas —
 * zooming moves `view`, exactly as the concept does it).
 */
export const NAME_W = 148;
/** Floor so a fast render is still a target, not a hairline. */
const MIN_CLIP_PX = 4;

/** Collapse the occupancy buckets into the single span the strip covers. */
function densityBand(buckets: DensityBucket[]): { t0: number; t1: number; count: number } | null {
  let t0 = Number.POSITIVE_INFINITY;
  let t1 = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const bucket of buckets) {
    if (bucket.count === 0) continue;
    t0 = Math.min(t0, bucket.t0);
    t1 = Math.max(t1, bucket.t1);
    count += bucket.count;
  }
  return Number.isFinite(t0) ? { t0, t1, count } : null;
}

export interface View {
  t0: number;
  t1: number;
}

export interface LaneViewRow {
  kind: "lane" | "sub";
  key: LaneKey;
  lane: Lane;
  label: string;
  suffix: string | null;
  clips: Clip[];
  density: DensityBucket[];
  expandable: boolean;
  expanded: boolean;
}

export function laneViewRows(lanes: Lane[], expanded: ReadonlySet<LaneKey>): LaneViewRow[] {
  const rows: LaneViewRow[] = [];
  for (const lane of lanes) {
    const expandable = lane.subs.length > 0;
    const open = expandable && expanded.has(lane.key);
    rows.push({
      kind: "lane",
      key: lane.key,
      lane,
      label: lane.name,
      suffix: lane.instanceCount > 1 ? `×${lane.instanceCount}` : null,
      clips: expandable ? [] : lane.clips,
      density: expandable ? lane.density : [],
      expandable,
      expanded: open,
    });
    if (!open) continue;
    for (const sub of lane.subs) {
      rows.push({
        kind: "sub",
        key: sub.key,
        lane,
        label: sub.label,
        suffix: null,
        clips: sub.clips,
        density: [],
        expandable: false,
        expanded: false,
      });
    }
  }
  return rows;
}

export function LanesView({
  rows,
  region,
  playhead,
  timeOrigin,
  xOf,
  scaleWidth,
  idleSegs = [],
  selectedRender,
  selectedLane,
  arrows,
  lanes,
  fixApplied = false,
  onToggleExpand,
  onSelectLane,
  onSelectClip,
  onHighlight,
  onScrub,
  scrollX,
  onScroll,
  onPan,
  onRegionEdge,
}: {
  rows: LaneViewRow[];
  region: { t0: number; t1: number } | null;
  playhead: number;
  /**
   * Session start. Raw timestamps are `performance.now()` offsets, so every
   * user-facing time is rendered relative to this — otherwise the playhead
   * chip reads "3,274 ms" while the ruler beside it reads "6 ms".
   */
  timeOrigin: number;
  /** Idle-compressed x position (px from track left) — same scale as the ruler. */
  xOf: (t: number) => number;
  /** Total width of the compressed scale (usually = trackW). */
  scaleWidth: number;
  /** Compressed idle gutters, with a human duration ("1.4s") to label them. */
  idleSegs?: Array<{ x0: number; x1: number; label?: string }>;
  selectedRender: RenderId | null;
  selectedLane: LaneKey | null;
  arrows: CausalEdge[];
  lanes?: LaneControls;
  /** Theatrical "Replay with fix" — fade wasted clips, calm density. */
  fixApplied?: boolean;
  onToggleExpand: (key: LaneKey) => void;
  onSelectLane: (key: LaneKey) => void;
  onSelectClip: (clip: Clip) => void;
  onHighlight?: (id: ComponentId | null) => void;
  onScrub: (clientX: number) => void;
  /** Desired scroll offset (derived from the window) — applied imperatively. */
  scrollX?: number;
  /** Horizontal scroll offset changed — the shell turns it back into a window. */
  onScroll?: (scrollLeft: number) => void;
  /** Shift-drag pan, in pixels of track movement. */
  onPan: (deltaPx: number) => void;
  onRegionEdge: (side: "t0" | "t1", clientX: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panFrom = useRef<number | null>(null);
  // Measured, not read off the ref during render: on first paint the ref is
  // still null, which would make the minimum-width floor nonsense.
  const [{ hostW }, setHostSize] = useState({ hostW: 0, hostH: 0 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () =>
      setHostSize((prev) =>
        prev.hostW === el.clientWidth && prev.hostH === el.clientHeight
          ? prev
          : { hostW: el.clientWidth, hostH: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const trackW = Math.max(1, scaleWidth || hostW - NAME_W);
  /** Absolute px inside `.lanes`, which is what the concept positions with. */
  const px = (t: number) => NAME_W + xOf(t);
  /**
   * A sub-millisecond render over a multi-second window is a fraction of a
   * pixel wide. Clip width is honest about duration, but never below the
   * floor that keeps a render visible and clickable.
   */
  // Label when the compressed active span is short enough to read.
  const showLabels = trackW / Math.max(1, rows.reduce((n, r) => n + r.clips.length, 0) || 1) > 28;

  /**
   * Arrow geometry is MEASURED from the rendered clips, exactly as the concept
   * does it — never recomputed from the time model.
   *
   * Deriving endpoints analytically drifted: a sub-millisecond render is drawn
   * at a 4px minimum width, so its true right edge is nowhere near `px(t1)`,
   * and a density-collapsed group has no clip to point at. Measuring the DOM
   * makes the curve land on the box the user actually sees, and an edge whose
   * endpoint isn't drawn is simply skipped.
   */
  // Keep the scroller in sync with the window when it changes from elsewhere
  // (zoom, keyboard, auto-follow) — but never fight the user's own scrolling.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || scrollX === undefined) return;
    if (Math.abs(el.scrollLeft - scrollX) > 1.5) el.scrollLeft = scrollX;
  }, [scrollX]);

  const [arrowPaths, setArrowPaths] = useState<string[]>([]);
  useLayoutEffect(() => {
    const host = bodyRef.current?.querySelector(".lanes-inner") as HTMLElement | null;
    if (!host || arrows.length === 0) {
      setArrowPaths((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const base = host.getBoundingClientRect();
    const rectOf = (id: RenderId) => {
      const el = host.querySelector(`[data-clip="${String(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - base.left,
        right: r.right - base.left,
        y: (r.top + r.bottom) / 2 - base.top,
      };
    };
    const next: string[] = [];
    for (const edge of arrows) {
      const a = rectOf(edge.from);
      const b = rectOf(edge.to);
      if (!a || !b) continue;
      const x1 = a.right - 4;
      const x2 = b.left + 4;
      next.push(`M ${x1} ${a.y} C ${x1 + 40} ${a.y}, ${x2 - 40} ${b.y}, ${x2} ${b.y}`);
    }
    setArrowPaths((prev) =>
      prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next,
    );
  });

  return (
    <div
      className="lanes"
      ref={hostRef}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".clip, .lname, .rhandle")) return;
        // Shift-drag (or middle-drag) pans the axis, like an NLE; a plain drag
        // scrubs the playhead.
        if (e.shiftKey || e.button === 1) {
          panFrom.current = e.clientX;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
        onScrub(e.clientX);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (panFrom.current !== null) {
          const dx = e.clientX - panFrom.current;
          panFrom.current = e.clientX;
          onPan(-dx);
          return;
        }
        if (e.buttons === 1 && !(e.target as HTMLElement).closest(".rhandle")) onScrub(e.clientX);
      }}
      onPointerUp={() => {
        panFrom.current = null;
      }}
    >
      <div
        className="lanes-body lanes-scroll"
        ref={bodyRef}
        onScroll={(e) => onScroll?.((e.currentTarget as HTMLElement).scrollLeft)}
      >
        <div className="lanes-inner" style={{ width: NAME_W + scaleWidth }}>
          {rows.map((row) => {
            const state = lanes ? laneVisibility(lanes.filter, row.key) : "visible";
            const muted = state === "muted";
            return (
              <div
                key={row.key}
                className={`lane${row.kind === "sub" ? " sub" : ""}${
                  state === "visible" ? "" : " dim"
                }${selectedLane === row.key ? " hl" : ""}`}
                data-lane={row.key}
              >
                <div
                  className="lname"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row.expandable) onToggleExpand(row.key);
                    else onSelectLane(row.key);
                  }}
                  title={`${row.lane.name} · ${row.lane.renders} renders${
                    row.lane.wasted > 0 ? ` · ${row.lane.wasted} wasted` : ""
                  }`}
                >
                  {row.expandable && <span className="chev">{row.expanded ? "▾" : "▸"}</span>}
                  {row.label}
                  {row.suffix && <span className="x"> {row.suffix}</span>}
                  {muted && <span className="mtag">muted</span>}
                </div>
                <div className="track">
                  {densityBand(row.density) &&
                    (() => {
                      const band = densityBand(row.density)!;
                      const left = xOf(band.t0);
                      const width = Math.max(MIN_CLIP_PX, xOf(band.t1) - left);
                      return (
                        <div
                          className={`density${fixApplied ? " fixedmode" : ""}`}
                          style={{ left, width }}
                          title={`${band.count} renders across ${row.lane.instanceCount} instances`}
                        />
                      );
                    })()}
                  {row.clips.map((clip) => {
                    const left = xOf(clip.t0);
                    const width = Math.max(MIN_CLIP_PX, xOf(clip.t1) - left);
                    return (
                      <div
                        key={clip.renderId}
                        className={`clip c-${clipCauseColor(clip.cause)}${clip.wasted ? " wasted" : ""}${
                          selectedRender === clip.renderId ? " sel" : ""
                        }${fixApplied && clip.wasted ? " fadeout" : ""}`}
                        data-clip={clip.renderId}
                        style={{ left, width }}
                        title={`${clip.name} · ${clip.cause} · ${clip.self.toFixed(1)} ms${
                          clip.wasted ? " · no observable change" : ""
                        }`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerEnter={() => onHighlight?.(clip.componentId)}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClip(clip);
                        }}
                      >
                        {showLabels && clipLabel(clip)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <Arrows paths={arrowPaths} />

          {/* Everything below is positioned in CONTENT pixels, so it lives
              inside the scrolled canvas — outside it, the playhead and the
              region would stay put while the lanes scrolled under them. */}
          <div className="lanes-chrome">
            {idleSegs.map((seg, i) => (
              <div
                key={`idle-${i}`}
                className="idle"
                style={{
                  left: NAME_W + seg.x0,
                  width: Math.max(0, seg.x1 - seg.x0),
                }}
                title={seg.label ? `${seg.label} idle` : "idle"}
              >
                {seg.label}
              </div>
            ))}

            {region && (
              <>
                <div
                  className="region"
                  style={{
                    left: px(region.t0),
                    width: Math.max(0, px(region.t1) - px(region.t0)),
                  }}
                />
                {(["t0", "t1"] as const).map((side) => (
                  <div
                    key={side}
                    className="rhandle"
                    style={{ left: px(region[side]) - 4 }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      if (e.buttons === 1) onRegionEdge(side, e.clientX);
                    }}
                  />
                ))}
              </>
            )}

            <div className="playhead" style={{ left: px(playhead) }} />
            <div className="ph-chip" style={{ left: px(playhead) + 8 }}>
              t = {Math.round(playhead - timeOrigin).toLocaleString("en-US")} ms
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Concept-style chip text: short cause tags, duration only when it matters. */
function clipLabel(clip: Clip): string {
  if (clip.wasted) return "wasted";
  switch (clip.cause) {
    case "context":
      return clip.self >= 0.5 ? `ctx · ${clip.self.toFixed(1)} ms` : "ctx";
    case "cascade":
      return "casc";
    case "state":
      return clip.name === "CartProvider" ? "setCart" : "state";
    case "props":
      return "props";
    case "mount":
      return "mount";
    default:
      return clip.cause;
  }
}

/** The concept's arrow layer: bezier curves with a shared arrowhead marker. */
function Arrows({ paths }: { paths: string[] }) {
  if (paths.length === 0) return null;
  // No viewBox on purpose: the paths are already in CSS pixels relative to
  // `.lanes`, and a viewBox built from a stale measurement would rescale them
  // away from the clips they point at.
  return (
    <svg className="arrows">
      <defs>
        <marker
          id="ah"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill="#A78BFA" />
        </marker>
      </defs>
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke="#A78BFA"
          strokeWidth="1.2"
          fill="none"
          opacity="0.8"
          markerEnd="url(#ah)"
        />
      ))}
    </svg>
  );
}
