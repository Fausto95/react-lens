import { useRef } from "react";
import type { TimeAxis } from "../model/axis.js";
import type { ViewWindow } from "../model/viewport.js";
import { clipCauseColor, type Clip } from "../model/lanes.js";
import { CAUSE_COLOR, NAV_H } from "./metrics.js";

/**
 * Session minimap in **compressed axis** space — idle gaps stay gutters, so
 * commits sit close together instead of stretching across empty wall time.
 */
export function Navigator({
  nameW,
  axis,
  view,
  blips,
  onView,
}: {
  nameW: number;
  axis: TimeAxis;
  view: ViewWindow;
  blips: readonly Clip[];
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
  const left = pct(view.a0);
  const width = Math.max(pct(view.a1) - left, 1.2);

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
      const na0 = Math.max(0, Math.min(total - span, d.a0 + dA));
      onView(na0, span, false);
    } else if (d.mode === "l") {
      const na0 = Math.max(0, Math.min(d.a1 - 30, d.a0 + dA));
      onView(na0, d.a1 - na0, false);
    } else {
      const na1 = Math.max(d.a0 + 30, Math.min(total, d.a1 + dA));
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
        {axis.segs
          .filter((s) => s.type === "gap")
          .map((s) => (
            <div
              key={s.id}
              className="tl-nav-gap"
              style={{
                left: `${pct(s.a0)}%`,
                width: `${Math.max(pct(s.a1) - pct(s.a0), 0.15)}%`,
              }}
            />
          ))}
        {blips.map((c) => (
          <i
            key={String(c.renderId)}
            className="tl-nav-blip"
            style={{
              left: `${pct(axis.wallToAxis(c.t0))}%`,
              top: 10 + ((c.row ?? 0) % 2) * 5,
              background: c.wasted ? "#F5A623" : CAUSE_COLOR[clipCauseColor(c.cause)],
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
