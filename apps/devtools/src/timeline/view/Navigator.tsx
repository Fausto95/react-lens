import { useRef } from "react";
import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { NAV_H } from "./metrics.js";

/**
 * Session minimap in **compressed axis** space — idle gaps stay gutters, so
 * commits sit close together instead of stretching across empty wall time.
 */
export function Navigator({
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
  onView: (a0: number, span: number, animate?: boolean) => void;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    mode: "pan" | "l" | "r";
    x: number;
    a0: number;
    a1: number;
  } | null>(null);

  const total = Math.max(1, axis.total);
  const pct = (a: number) => (a / total) * 100;
  const activity = axis.segs.filter(
    (s): s is Extract<(typeof axis.segs)[number], { type: "act" }> => s.type === "act",
  );
  // Past-fit zoom: clamp the chrome window to the track (full width = seeing margins).
  const left = Math.max(0, pct(view.a0));
  const width = Math.max(Math.min(100, pct(view.a1)) - left, 1.2);

  const onDown = (e: React.PointerEvent, mode: "pan" | "l" | "r") => {
    e.stopPropagation();
    drag.current = { mode, x: e.clientX, a0: view.a0, a1: view.a1 };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !navRef.current) return;
    const navW = navRef.current.clientWidth;
    const dA = ((e.clientX - d.x) / navW) * total;
    const span = d.a1 - d.a0;
    if (d.mode === "pan") {
      // clampView (via setView) allows a0 < 0 when span > total.
      onView(d.a0 + dA, span, false);
    } else if (d.mode === "l") {
      const na0 = Math.min(d.a1 - 30, d.a0 + dA);
      onView(na0, d.a1 - na0, false);
    } else {
      const na1 = Math.max(d.a0 + 30, d.a1 + dA);
      onView(d.a0, na1 - d.a0, false);
    }
  };

  return (
    <div
      className="tl-nav"
      style={{ height: NAV_H }}
      onPointerMove={onMove}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      <div style={{ width: nameW, flexShrink: 0 }} className="tl-nav-spacer" />
      <div
        ref={navRef}
        className="tl-nav-track"
        onPointerDown={(e) => {
          if (!navRef.current) return;
          const r = navRef.current.getBoundingClientRect();
          const a = ((e.clientX - r.left) / r.width) * total;
          const span = view.a1 - view.a0;
          onView(a - span / 2, span, true);
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
            className="tl-nav-gap"
            style={{
              left: `${pct(s.a0)}%`,
              width: `${Math.max(pct(s.a1) - pct(s.a0), 0.15)}%`,
            }}
          />
        ))}
        {activity.map((s, i) => (
          <i
            key={`${s.w0}:${s.w1}:${i}`}
            className="tl-nav-activity"
            style={{
              left: `${pct(s.a0)}%`,
              width: `${Math.max(pct(s.a1) - pct(s.a0), 0.18)}%`,
            }}
          />
        ))}
        <div
          className="tl-nav-window"
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={(e) => onDown(e, "pan")}
        >
          <div className="tl-nav-handle left" onPointerDown={(e) => onDown(e, "l")}>
            <i />
          </div>
          <div className="tl-nav-handle right" onPointerDown={(e) => onDown(e, "r")}>
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}
