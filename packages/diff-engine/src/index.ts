export { diff } from "./diff.js";
// Used by the panel to check that a restore reached the paint, not just the
// hook: the page's current DOM against the DOM captured at the cursor.
export { compareDom } from "./dom-diff.js";
export type {
  DiffTarget,
  DiffTargetKind,
  DiffResult,
  DiffChange,
  DiffSummary,
  ChangeKind,
} from "./types.js";
