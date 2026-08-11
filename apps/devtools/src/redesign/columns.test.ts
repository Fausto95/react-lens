import { describe, it, expect } from "vite-plus/test";
import { RAIL_W, columnTemplate, nextColumnWidth, TIMELINE_MIN } from "./columns.js";

describe("columnTemplate", () => {
  it("gives each side pane its width and the timeline the rest", () => {
    expect(columnTemplate(272, 320, { tree: false, inspector: false })).toBe(
      "272px minmax(0, 1fr) 320px",
    );
  });

  it("shrinks a collapsed pane to a rail without disturbing the other", () => {
    expect(columnTemplate(272, 320, { tree: true, inspector: false })).toBe(
      `${RAIL_W}px minmax(0, 1fr) 320px`,
    );
    expect(columnTemplate(272, 320, { tree: false, inspector: true })).toBe(
      `272px minmax(0, 1fr) ${RAIL_W}px`,
    );
  });

  it("hands the whole width to the timeline when both are collapsed", () => {
    expect(columnTemplate(272, 320, { tree: true, inspector: true })).toBe(
      `${RAIL_W}px minmax(0, 1fr) ${RAIL_W}px`,
    );
  });
});

describe("nextColumnWidth", () => {
  const total = 1200;

  it("follows the pointer within the pane's own range", () => {
    expect(nextColumnWidth("tree", 300, { total, treeW: 272, inspW: 320 })).toBe(300);
    expect(nextColumnWidth("inspector", 400, { total, treeW: 272, inspW: 320 })).toBe(400);
  });

  it("clamps to the pane's minimum and maximum", () => {
    expect(nextColumnWidth("tree", 20, { total, treeW: 272, inspW: 320 })).toBe(180);
    expect(nextColumnWidth("tree", 9999, { total, treeW: 272, inspW: 320 })).toBe(520);
    expect(nextColumnWidth("inspector", 10, { total, treeW: 272, inspW: 320 })).toBe(260);
  });

  it("never squeezes the timeline below the width its controls need", () => {
    // Dragging used to crush the middle column to ~40px, putting the zoom and
    // transport buttons out of reach.
    const w = nextColumnWidth("tree", 900, { total: 1000, treeW: 272, inspW: 320 });
    expect(1000 - w - 320).toBeGreaterThanOrEqual(TIMELINE_MIN);
  });

  it("keeps the dragged pane usable when the minimums cannot all fit", () => {
    // Below ~840px the three minimums do not fit at once. The pane being
    // dragged keeps its own minimum rather than collapsing by stealth —
    // collapsing is a deliberate act, with a button.
    expect(nextColumnWidth("tree", 900, { total: 700, treeW: 272, inspW: 320 })).toBe(180);
  });

  it("counts a collapsed neighbour as a rail, so the pane may grow into it", () => {
    const open = nextColumnWidth("tree", 9999, { total: 900, treeW: 272, inspW: 320 });
    const railed = nextColumnWidth("tree", 9999, {
      total: 900,
      treeW: 272,
      inspW: 320,
      collapsed: { tree: false, inspector: true },
    });
    expect(railed).toBeGreaterThan(open);
  });
});
