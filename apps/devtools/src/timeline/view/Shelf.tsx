import { MONO, SHELF_H } from "./metrics.js";
import type { Lane } from "../model/lanes.js";

export function Shelf({
  quietLanes,
  open,
  narrow,
  onToggle,
}: {
  quietLanes: readonly Lane[];
  open: boolean;
  narrow: boolean;
  onToggle: () => void;
}) {
  const renders = quietLanes.reduce((a, l) => a + l.clips.length, 0);
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
      {quietLanes.length} quiet components
      <span className="tl-shelf-pill">{renders} renders</span>
      {!narrow && (
        <span className="tl-shelf-hint">
          {open ? "click to tuck away" : "auto-tucked — click to open"}
        </span>
      )}
    </div>
  );
}
