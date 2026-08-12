import type { Clip } from "../model/lanes.js";
import { clipCauseColor } from "../model/lanes.js";
import { CAUSE_COLOR, ACCENT, MONO } from "./metrics.js";

export function Footer({
  selection,
  inScope,
  wastedN,
  idleCollapsedMs,
  regionActive,
  transport,
}: {
  selection: Clip | null;
  inScope: number;
  wastedN: number;
  idleCollapsedMs: number;
  regionActive: boolean;
  transport?: React.ReactNode;
}) {
  const fmt = (t: number) => Math.round(t).toLocaleString("en-US");
  return (
    <div className="tlfoot tl-canvas-foot">
      {transport && <div className="rl-tl-nav">{transport}</div>}
      {selection && (
        <span className="mono" style={{ fontFamily: MONO, fontSize: 10 }}>
          <b style={{ color: "#E8E8EB" }}>
            {selection.name}
            {selection.componentId != null ? ` #${selection.componentId}` : ""}
          </b>
          <span style={{ color: CAUSE_COLOR[clipCauseColor(selection.cause)], marginLeft: 6 }}>
            {clipCauseColor(selection.cause)}
          </span>
          {selection.wasted && <span style={{ color: "#F5A623", marginLeft: 6 }}>wasted</span>}
          <span style={{ color: "#5C5C66", marginLeft: 6 }}>
            {fmt(selection.t0)}–{fmt(selection.t1)} ms
          </span>
        </span>
      )}
      <span style={{ marginLeft: "auto" }}>
        {regionActive ? "selection" : "all"}:{" "}
        <b style={{ color: "#E8E8EB" }}>{inScope}</b> renders
      </span>
      <span className="mono" style={{ color: "#F5A623" }}>
        {wastedN} wasted
      </span>
      <span className="mono" style={{ color: "#5C5C66" }}>
        idle collapsed {(idleCollapsedMs / 1000).toFixed(1)}s
      </span>
      <span className="mono" style={{ color: "#3E3E46" }}>
        ? for shortcuts
      </span>
      <span style={{ color: ACCENT, opacity: 0 }} aria-hidden>
        ·
      </span>
    </div>
  );
}
