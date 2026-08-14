import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { MONO, WALL_H } from "./metrics.js";

export function WallStrip({
  nameW,
  axis,
  view,
  commits,
  gaps,
  onView,
}: {
  nameW: number;
  axis: TimeAxis;
  view: ViewWindow;
  commits: readonly { timestamp: number; endTimestamp: number }[];
  gaps?: readonly Extract<TimeAxis["segs"][number], { type: "gap" }>[];
  onView?: (a0: number, span: number) => void;
}) {
  const total = Math.max(1, axis.total);
  const pct = (a: number) => (a / total) * 100;
  const left = Math.max(0, pct(view.a0));
  const width = Math.max(Math.min(100, pct(view.a1)) - left, 0.5);

  // The overview is a commit map, not a generic activity texture. No commit
  // means no bar. Very short commits keep a tiny visual mark so sparse sessions
  // remain navigable without inventing activity in empty time ranges.
  const commitBars = commits.map((commit, index) => {
    const a0 = axis.wallToAxis(commit.timestamp);
    const a1 = axis.wallToAxis(Math.max(commit.timestamp, commit.endTimestamp));
    const start = Math.max(0, Math.min(total, a0));
    const end = Math.max(start, Math.min(total, a1));
    const duration = Math.max(0, commit.endTimestamp - commit.timestamp);
    return {
      key: `${commit.timestamp}:${commit.endTimestamp}:${index}`,
      left: pct(start),
      width: Math.max(pct(end) - pct(start), 0.08),
      duration,
    };
  });
  const maxDuration = Math.max(0.01, ...commitBars.map((bar) => bar.duration));

  return (
    <div className="tl-wall" style={{ height: WALL_H }}>
      <div className="tl-wall-label" style={{ width: nameW, fontFamily: MONO }}>
        SESSION
      </div>
      <div
        className="tl-wall-track"
        title="Session overview · each bar is a commit · click to navigate"
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

        {commitBars.map((bar) => {
          const strength = 0.38 + 0.5 * Math.min(1, bar.duration / maxDuration);
          return (
            <i
              key={bar.key}
              className="tl-wall-activity"
              title={`${bar.duration.toFixed(2)}ms commit`}
              style={{
                left: `${bar.left}%`,
                width: `${bar.width}%`,
                opacity: strength,
                background: "var(--state)",
              }}
            />
          );
        })}

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
