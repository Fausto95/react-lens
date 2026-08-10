/**
 * The global time cursor (redesign §6): one timestamp shared by the Timeline,
 * Tree, and Inspector. "live" tracks the present; "historical" is a scrubbed
 * moment. A/B marks two timestamps that any view can diff (§28).
 */
export interface TimeCursor {
  /** page-clock timestamp (performance.now) at the cursor. */
  t: number;
  mode: "live" | "historical";
}

export interface ABMarks {
  a?: number;
  b?: number;
}
