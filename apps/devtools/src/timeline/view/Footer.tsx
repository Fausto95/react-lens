import type { Clip } from "../model/lanes.js";
import { clipCauseColor } from "../model/lanes.js";
import { causeCssVar } from "./timelineTheme.js";

export function Footer({
  selection,
  inScope,
  wastedN,
  idleCollapsedMs,
  regionActive,
  onExpandIdle,
}: {
  selection: Clip | null;
  inScope: number;
  wastedN: number;
  idleCollapsedMs: number;
  regionActive: boolean;
  /** Expand all fully-compressed idle gaps back toward wall time. */
  onExpandIdle?: () => void;
}) {
  const fmt = (t: number) => Math.round(t).toLocaleString("en-US");
  const idleLabel = `idle collapsed ${(idleCollapsedMs / 1000).toFixed(1)}s`;
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
      {idleCollapsedMs > 0 && onExpandIdle ? (
        <button
          type="button"
          className="tl-foot-idle"
          title="Expand compressed idle gaps"
          onClick={onExpandIdle}
        >
          {idleLabel} · expand
        </button>
      ) : (
        <span className="mono" style={{ color: "var(--text-3)" }}>
          {idleLabel}
        </span>
      )}
      <span className="mono" style={{ color: "var(--text-3)" }}>
        ? for shortcuts
      </span>
      <span style={{ color: "var(--accent)", opacity: 0 }} aria-hidden>
        ·
      </span>
    </div>
  );
}
