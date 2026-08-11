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

/** Rough px a marker label occupies, for collision tests. */
const LABEL_CHAR_PX = 5.6;
const PIN_PX = 16;
/** Gap a label needs before the next pin to stay readable. */
const LABEL_GAP_PX = 10;

export interface PlacedMarker {
  marker: RulerMarker;
  x: number;
  labelled: boolean;
}

/**
 * Decide which markers get to show their text.
 *
 * Pins are always drawn — losing one would hide a real event — but a label is
 * only rendered when it fits before the next pin. Without this, a burst of
 * interactions stacks four labels on top of each other and over the tick
 * numbers, which is worse than showing none of them.
 */
export function placeMarkers(
  markers: readonly RulerMarker[],
  xOf: (t: number) => number,
  showLabels: boolean,
): PlacedMarker[] {
  const placed = markers
    .map((marker) => ({ marker, x: xOf(marker.t), labelled: false }))
    .sort((a, b) => a.x - b.x);

  for (const [i, entry] of placed.entries()) {
    if (!showLabels) continue;
    const next = placed[i + 1];
    const room = next ? next.x - entry.x : Number.POSITIVE_INFINITY;
    const needed = PIN_PX + entry.marker.label.length * LABEL_CHAR_PX + LABEL_GAP_PX;
    entry.labelled = room >= needed;
  }
  return placed;
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
        {placeMarkers(markers, xOf, showMarkerLabels).map(({ marker, x, labelled }) => (
          <div
            key={marker.key}
            className={`marker${marker.long ? " long" : ""}`}
            style={{ left: x }}
            // The pin always carries the full text, so a dropped label is
            // still reachable on hover rather than lost.
            title={marker.label}
          >
            <i>{marker.long ? "!" : "◆"}</i>
            {labelled ? marker.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

export { NAME_W };
