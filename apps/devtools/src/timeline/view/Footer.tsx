import type { Clip } from "../model/lanes.js";
import { clipCauseColor } from "../model/lanes.js";
import { causeCssVar } from "./timelineTheme.js";

export function Footer({
  selection,
  inScope,
  wastedN,
  idleCollapsedMs,
  regionActive,
}: {
  selection: Clip | null;
  inScope: number;
  wastedN: number;
  idleCollapsedMs: number;
  regionActive: boolean;
}) {
  const fmt = (t: number) => Math.round(t).toLocaleString("en-US");
  return (
    <div className="tlfoot tl-canvas-foot">
      {selection && (
        <span className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>
          <b style={{ color: "var(--text)" }}>
            {selection.name}
            {selection.componentId != null ? ` #${selection.componentId}` : ""}
          </b>
          <span style={{ color: causeCssVar(clipCauseColor(selection.cause)), marginLeft: 6 }}>
            {clipCauseColor(selection.cause)}
          </span>
          {selection.wasted && <span style={{ color: "var(--warn)", marginLeft: 6 }}>wasted</span>}
          <span style={{ color: "var(--text-3)", marginLeft: 6 }}>
            {fmt(selection.t0)}–{fmt(selection.t1)} ms
          </span>
        </span>
      )}
      <span style={{ marginLeft: "auto" }}>
        {regionActive ? "selection" : "all"}:{" "}
        <b style={{ color: "var(--text)" }}>{inScope}</b> renders
      </span>
      <span className="mono" style={{ color: "var(--warn)" }}>
        {wastedN} wasted
      </span>
      <span className="mono" style={{ color: "var(--text-3)" }}>
        idle collapsed {(idleCollapsedMs / 1000).toFixed(1)}s
      </span>
      <span className="mono" style={{ color: "var(--text-3)" }}>
        ? for shortcuts
      </span>
      <span style={{ color: "var(--accent)", opacity: 0 }} aria-hidden>
        ·
      </span>
    </div>
  );
}
