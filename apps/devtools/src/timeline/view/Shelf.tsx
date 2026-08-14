import { MONO, SHELF_H } from "./metrics.js";
import type { Lane } from "../model/lanes.js";

export function Shelf({
  quietLanes,
  quietSummary,
  open,
  narrow,
  onToggle,
}: {
  quietLanes: readonly Lane[];
  quietSummary?: { lanes: number; renders: number };
  open: boolean;
  narrow: boolean;
  onToggle: () => void;
}) {
  const quietCount = quietSummary?.lanes ?? quietLanes.length;
  const renders = quietSummary?.renders ?? quietLanes.reduce((a, l) => a + l.renders, 0);
  return (
    <div
      className="tl-shelf"
      style={{ height: SHELF_H, fontFamily: MONO }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <span>{open ? "▾" : "▸"}</span>
      {quietCount} quiet components
      <span className="tl-shelf-pill">{renders} renders</span>
      {!narrow && (
        <span className="tl-shelf-hint">
          {open ? "click to tuck away" : "auto-tucked — click to open"}
        </span>
      )}
    </div>
  );
}
