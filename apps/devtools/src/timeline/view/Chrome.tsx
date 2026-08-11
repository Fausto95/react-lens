import type { Seg, TimeSpan } from "../model/scale.js";
import { compactGap } from "../ticks.js";
import { NAME_W } from "./metrics.js";

/**
 * Everything drawn across the lanes rather than inside one: compressed idle
 * gutters, the in/out region, and the playhead.
 *
 * All of it is positioned in *canvas* pixels, so it lives inside the scrolled
 * content — outside it, the playhead and region would stay pinned while the
 * lanes slid underneath them.
 */
export function Chrome({
  idleSegs,
  region,
  playhead,
  origin,
  looping,
  canvasWidth,
  viewportRight,
  xOf,
  onRegionEdge,
}: {
  idleSegs: readonly Seg[];
  region: TimeSpan | null;
  playhead: number;
  /** Session start — the playhead chip reads relative, like the ruler. */
  origin: number;
  looping: boolean;
  /** Full canvas width, for right-anchoring the chip when it flips. */
  canvasWidth: number;
  /** Right edge of the visible scrollport, in canvas px. */
  viewportRight: number;
  xOf: (t: number) => number;
  onRegionEdge: (side: "start" | "end", clientX: number) => void;
}) {
  const px = (t: number) => NAME_W + xOf(t);
  /** ~130px is the widest the chip gets ("t = 123,456 ms"). */
  const flipChip = px(playhead) + 130 > viewportRight;
  return (
    <div className="lanes-chrome">
      {/* Compression is honest about what it hid: each gutter says how much
          wall-clock time it stands for. */}
      {idleSegs.map((seg, i) => (
        <div
          key={`idle-${i}`}
          className="idle"
          style={{ left: NAME_W + seg.x0, width: Math.max(0, seg.x1 - seg.x0) }}
          title={`${compactGap(seg.t1 - seg.t0)} idle`}
        >
          {compactGap(seg.t1 - seg.t0)}
        </div>
      ))}

      {region && (
        <>
          <div
            className={`region${looping ? " looping" : ""}`}
            style={{
              left: px(region.start),
              width: Math.max(0, px(region.end) - px(region.start)),
            }}
          />
          {(["start", "end"] as const).map((side) => (
            <div
              key={side}
              className="rhandle"
              style={{ left: px(region[side]) - 4 }}
              title={side === "start" ? "Region start" : "Region end"}
              onPointerDown={(e) => {
                e.stopPropagation();
                try {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                } catch {
                  /* synthetic pointers have no capturable id */
                }
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) onRegionEdge(side, e.clientX);
              }}
            />
          ))}
        </>
      )}

      <div className="playhead" style={{ left: px(playhead) }} />
      {/* Flip to the playhead's left near the end of the canvas, so the chip
          never runs past the column and over the inspector. */}
      <div
        className={`ph-chip${flipChip ? " flip" : ""}`}
        style={flipChip ? { right: canvasWidth - px(playhead) + 8 } : { left: px(playhead) + 8 }}
      >
        t = {Math.round(playhead - origin).toLocaleString("en-US")} ms
      </div>
    </div>
  );
}
