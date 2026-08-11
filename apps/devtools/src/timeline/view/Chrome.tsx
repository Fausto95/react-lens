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
  xOf,
  onRegionEdge,
}: {
  idleSegs: readonly Seg[];
  region: TimeSpan | null;
  playhead: number;
  /** Session start — the playhead chip reads relative, like the ruler. */
  origin: number;
  looping: boolean;
  xOf: (t: number) => number;
  onRegionEdge: (side: "start" | "end", clientX: number) => void;
}) {
  const px = (t: number) => NAME_W + xOf(t);
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
      <div className="ph-chip" style={{ left: px(playhead) + 8 }}>
        t = {Math.round(playhead - origin).toLocaleString("en-US")} ms
      </div>
    </div>
  );
}
