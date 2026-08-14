import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { MONO, WALL_H } from "./metrics.js";

export function WallStrip({
  nameW,
  axis,
  view,
  bounds,
  commits,
  onView,
}: {
  nameW: number;
  axis: TimeAxis;
  view: ViewWindow;
  bounds: { t0: number; t1: number };
  commits: ReadonlyArray<{ timestamp: number; endTimestamp: number }>;
  onView?: (a0: number, span: number) => void;
}) {
  const wallSpan = Math.max(0.001, bounds.t1 - bounds.t0);
  const wallPct = (t: number) => ((t - bounds.t0) / wallSpan) * 100;
  const viewWall0 = axis.axisToWall(Math.max(0, view.a0));
  const viewWall1 = axis.axisToWall(Math.min(axis.total, view.a1));
  const left = Math.max(0, Math.min(100, wallPct(viewWall0)));
  const right = Math.max(left, Math.min(100, wallPct(viewWall1)));
  const width = Math.max(right - left, 0.5);
  const maxDuration = Math.max(
    0.01,
    ...commits.map((commit) => Math.max(0, commit.endTimestamp - commit.timestamp)),
  );

  return (
    <div className="tl-wall" style={{ height: WALL_H }}>
      <div className="tl-wall-label" style={{ width: nameW, fontFamily: MONO }}>
        SESSION
      </div>
      <div
        className="tl-wall-track"
        title="Session overview · exact commit spans · click to navigate"
        onPointerDown={(e) => {
          if (!onView) return;
          const r = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
          const wallT = bounds.t0 + ratio * wallSpan;
          const centerA = axis.wallToAxis(wallT);
          const span = view.a1 - view.a0;
          onView(centerA - span / 2, span);
        }}
      >
        {commits.map((commit, i) => {
          const duration = Math.max(0, commit.endTimestamp - commit.timestamp);
          const strength = 0.42 + 0.46 * Math.min(1, duration / maxDuration);
          return (
            <i
              key={`${commit.timestamp}:${commit.endTimestamp}:${i}`}
              className="tl-wall-activity"
              title={`${duration.toFixed(2)}ms commit`}
              style={{
                left: `${Math.max(0, Math.min(100, wallPct(commit.timestamp)))}%`,
                width: `${Math.max(0, Math.min(100, (duration / wallSpan) * 100))}%`,
                minWidth: duration > 0 ? 1 : 0,
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
