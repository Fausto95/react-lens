import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { MONO, WALL_H } from "./metrics.js";

export function WallStrip({
  nameW,
  axis,
  view,
  gaps,
  onView,
}: {
  nameW: number;
  axis: TimeAxis;
  view: ViewWindow;
  gaps?: readonly Extract<TimeAxis["segs"][number], { type: "gap" }>[];
  onView?: (a0: number, span: number) => void;
}) {
  const total = Math.max(1, axis.total);
  const pct = (a: number) => (a / total) * 100;
  const activity = axis.segs.filter(
    (s): s is Extract<(typeof axis.segs)[number], { type: "act" }> => s.type === "act",
  );
  const left = Math.max(0, pct(view.a0));
  const width = Math.max(Math.min(100, pct(view.a1)) - left, 0.5);

  return (
    <div className="tl-wall" style={{ height: WALL_H }}>
      <div className="tl-wall-label" style={{ width: nameW, fontFamily: MONO }}>
        SESSION
      </div>
      <div
        className="tl-wall-track"
        title="Session overview · click to navigate"
        onPointerDown={(e) => {
          if (!onView) return;
          const r = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
          const span = view.a1 - view.a0;
          onView(ratio * total - span / 2, span);
        }}
      >
        {(
          gaps ??
          axis.segs.filter((s): s is Extract<(typeof axis.segs)[number], { type: "gap" }> => {
            return s.type === "gap" && s.a1 - s.a0 > 1e-6;
          })
        ).map((s) => (
          <div
            key={s.id}
            className="tl-wall-gap"
            style={{ left: `${pct(s.a0)}%`, width: `${Math.max(pct(s.a1) - pct(s.a0), 0.15)}%` }}
          />
        ))}
        {activity.map((s, i) => (
          <i
            key={`${s.w0}:${s.w1}:${i}`}
            className="tl-wall-activity"
            style={{
              left: `${pct(s.a0)}%`,
              width: `${Math.max(pct(s.a1) - pct(s.a0), 0.12)}%`,
              // Read as an overview waveform rather than one opaque purple bar.
              // The fine stripes stay legible when a short recording is one
              // continuous activity segment, while gaps still cut the strip.
              background:
                "repeating-linear-gradient(90deg, color-mix(in srgb, var(--state) 78%, transparent) 0 2px, color-mix(in srgb, var(--props) 62%, transparent) 2px 3px, transparent 3px 5px)",
              opacity: 0.9,
            }}
          />
        ))}
        <div
          className="tl-wall-view"
          style={{
            left: `${left}%`,
            width: `${width}%`,
            background: "transparent",
            borderColor: "color-mix(in srgb, var(--accent) 75%, var(--line-strong))",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent)",
          }}
        />
      </div>
    </div>
  );
}
