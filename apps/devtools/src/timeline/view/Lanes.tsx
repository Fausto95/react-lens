import type { ComponentId } from "@reactlens/protocol";
import type { RenderId } from "@reactlens/protocol";
import { laneVisibility, type LaneControls, type LaneKey } from "../../laneFilter.js";
import { clipCauseColor, type Clip, type DensityBucket } from "../model/lanes.js";
import type { LaneRow } from "../model/rows.js";
import { inChunkRange, type ChunkRange } from "../model/culling.js";
import { CLIP_LABEL_MIN_PX, MIN_CLIP_PX } from "./metrics.js";

/** Concept chip text: a short cause tag, with duration when there's room. */
function clipLabel(clip: Clip): string {
  if (clip.wasted) return "wasted";
  switch (clip.cause) {
    case "context":
      return clip.self >= 0.5 ? `ctx · ${clip.self.toFixed(1)} ms` : "ctx";
    case "cascade":
      return "casc";
    case "state":
      return "state";
    case "props":
      return "props";
    case "mount":
      return "mount";
    default:
      return "render";
  }
}

/** The span a density band covers, collapsed from its occupancy buckets. */
function densityBand(
  buckets: readonly DensityBucket[],
): { t0: number; t1: number; count: number } | null {
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

export function Lanes({
  rows,
  xOf,
  cull,
  selectedRender,
  selectedLane,
  lanes,
  fixApplied,
  onToggleExpand,
  onSelectLane,
  onSelectClip,
  onHighlight,
}: {
  rows: readonly LaneRow[];
  xOf: (t: number) => number;
  cull: ChunkRange;
  selectedRender: RenderId | null;
  selectedLane: LaneKey | null;
  lanes?: LaneControls;
  fixApplied: boolean;
  onToggleExpand: (key: LaneKey) => void;
  onSelectLane: (key: LaneKey) => void;
  onSelectClip: (clip: Clip) => void;
  onHighlight?: (id: ComponentId | null) => void;
}) {
  return (
    <>
      {rows.map((row) => {
        const state = lanes ? laneVisibility(lanes.filter, row.key) : "visible";
        const band = densityBand(row.density);
        return (
          <div
            key={row.key}
            className={`lane${row.kind === "sub" ? " sub" : ""}${
              state === "visible" ? "" : " dim"
            }${selectedLane === row.key ? " hl" : ""}`}
            data-lane={row.key}
            style={{ height: row.height }}
          >
            <div
              className="lname"
              title={`${row.lane.name} · ${row.lane.renders} renders${
                row.lane.wasted > 0 ? ` · ${row.lane.wasted} wasted` : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                if (row.expandable) onToggleExpand(row.key);
                else onSelectLane(row.key);
              }}
            >
              {row.expandable && <span className="chev">{row.expanded ? "▾" : "▸"}</span>}
              {row.label}
              {row.suffix && <span className="x"> {row.suffix}</span>}
              {state === "muted" && <span className="mtag">muted</span>}
            </div>

            <div className="track">
              {band && (
                <div
                  className={`density${fixApplied ? " fixedmode" : ""}`}
                  style={{
                    left: xOf(band.t0),
                    width: Math.max(MIN_CLIP_PX, xOf(band.t1) - xOf(band.t0)),
                  }}
                  title={`${band.count} renders across ${row.lane.instanceCount} instances`}
                />
              )}

              {row.clips.map((clip) => {
                const left = xOf(clip.t0);
                const width = Math.max(MIN_CLIP_PX, xOf(clip.t1) - left);
                // Off-screen clips skip the DOM entirely; the window only
                // changes when a chunk boundary is crossed.
                if (!inChunkRange(cull, left, width)) return null;
                return (
                  <button
                    key={clip.renderId}
                    type="button"
                    className={`clip c-${clipCauseColor(clip.cause)}${
                      clip.wasted ? " wasted" : ""
                    }${selectedRender === clip.renderId ? " sel" : ""}${
                      fixApplied && clip.wasted ? " fadeout" : ""
                    }`}
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
                    {width >= CLIP_LABEL_MIN_PX ? clipLabel(clip) : ""}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
