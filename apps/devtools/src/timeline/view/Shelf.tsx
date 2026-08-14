import type { Lane } from "../model/lanes.js";

/**
 * Quiet-component auto-tucking has been retired. Keep this no-op export during
 * the timeline refactor so older call sites do not force a broad reducer/API
 * migration in the same PR; every lane is now included by useTimeline.
 */
export function Shelf(_props: {
  quietLanes: readonly Lane[];
  quietSummary?: { lanes: number; renders: number };
  open: boolean;
  narrow: boolean;
  onToggle: () => void;
}) {
  return null;
}
