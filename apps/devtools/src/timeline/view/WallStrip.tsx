import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { MONO, WALL_H } from "./metrics.js";

/**
 * Top overview strip in compressed axis space (same projection as the stage),
 * so idle is collapsed and activity clusters stay readable.
 */
export function WallStrip({
  nameW,
  axis,
  view,
  gaps,
}: {
  nameW: number;
  axis: TimeAxis;
  view: ViewWindow;
  gaps?: readonly Extract<TimeAxis["segs"][number], { type: "gap" }>[];
}) {
  const total = Math.max(1, axis.total);
  const pct = (a: number) => (a / total) * 100;
  const activity = axis.segs.filter(
    (s): s is Extract<(typeof axis.segs)[number], { type: "act" }> => s.type === "act",
  );
  // Past-fit zoom: clamp the chrome window to the track.
  const left = Math.max(0, pct(view.a0));
  const width = Math.max(Math.min(100, pct(view.a1)) - left, 0.5);

  return (
    <div className="tl-wall" style={{ height: WALL_H }}>
      <div className="tl-wall-label" style={{ width: nameW, fontFamily: MONO }}>
        AXIS
      </div>
      <div className="tl-wall-track">
        {(
          gaps ??
          axis.segs.filter((s): s is Extract<(typeof axis.segs)[number], { type: "gap" }> => {
            return s.type === "gap" && s.a1 - s.a0 > 1e-6;
          })
        ).map((s) => (
          <div
            key={s.id}
            className="tl-wall-gap"
            style={{
              left: `${pct(s.a0)}%`,
              width: `${Math.max(pct(s.a1) - pct(s.a0), 0.15)}%`,
            }}
          />
        ))}
        <div
          className="tl-wall-view"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            background: "color-mix(in srgb, var(--accent) 13%, transparent)",
          }}
        />
        {activity.map((s, i) => (
          <i
            key={`${s.w0}:${s.w1}:${i}`}
            className="tl-wall-activity"
            style={{
              left: `${pct(s.a0)}%`,
              width: `${Math.max(pct(s.a1) - pct(s.a0), 0.12)}%`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
