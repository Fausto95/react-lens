import type { Interaction, CommitSummary } from "@reactlens/trace-engine";
import { buildTicks } from "../ticks.js";
import type { Seg } from "../model/scale.js";
import { NAME_W } from "./metrics.js";

export interface RulerMarker {
  key: string;
  t: number;
  label: string;
  long: boolean;
}

/** Interaction pins plus long-task warnings, both inside the visible window. */
export function rulerMarkers(
  interactions: readonly Interaction[],
  commits: readonly CommitSummary[],
  longTaskMs: number,
): RulerMarker[] {
  const out: RulerMarker[] = [];
  for (const it of interactions) {
    out.push({ key: `i${it.id}`, t: it.start, label: it.label, long: false });
  }
  for (const commit of commits) {
    if (commit.totalSelfTime < longTaskMs) continue;
    out.push({
      key: `c${commit.commitId}`,
      t: commit.timestamp,
      label: `long task ${Math.round(commit.totalSelfTime)} ms`,
      long: true,
    });
  }
  return out;
}

/**
 * The time ruler. It lives inside the same horizontal scroller as the lanes
 * (sticky to the top) so the two can never drift out of alignment — there is
 * one scroll offset for the whole canvas, not two that need syncing.
 */
export function Ruler({
  segs,
  origin,
  width,
  markers,
  showMarkerLabels,
  xOf,
  onScrub,
}: {
  segs: Seg[];
  /** Session start: every label is relative to this, like the playhead chip. */
  origin: number;
  width: number;
  markers: readonly RulerMarker[];
  showMarkerLabels: boolean;
  xOf: (t: number) => number;
  onScrub: (clientX: number) => void;
}) {
  const ticks = buildTicks(segs, origin);
  return (
    <div className="ruler">
      <div className="rspacer" />
      <div
        className="rtrack"
        style={{ width }}
        onPointerDown={(e) => {
          onScrub(e.clientX);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) onScrub(e.clientX);
        }}
      >
        {ticks.map((tick, i) => (
          <div key={i} className="tick" style={{ left: tick.x }}>
            {tick.major && tick.label && <span>{tick.label}</span>}
          </div>
        ))}
        {markers.map((marker) => (
          <div
            key={marker.key}
            className={`marker${marker.long ? " long" : ""}`}
            style={{ left: xOf(marker.t) }}
            title={marker.label}
          >
            <i>{marker.long ? "!" : "◆"}</i>
            {showMarkerLabels ? marker.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export { NAME_W };
