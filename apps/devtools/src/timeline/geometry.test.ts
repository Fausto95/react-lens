import { describe, it, expect } from "vite-plus/test";
import {
  IDLE_GAP_MS,
  PANE_MIN_H,
  PANE_MAX_H,
  clampPaneHeight,
  fitPlan,
  IDLE_WIDTH,
  buildScale,
  clamp,
  countIdleGutters,
  mergeActive,
  nearest,
  projectT,
  projectX,
  scaleForProjectedWidth,
  sessionBounds,
  stickyLabelShift,
} from "./geometry.js";

const span = (start: number, end: number) => ({ start, end });

describe("mergeActive", () => {
  it("merges spans separated by at most the idle gap", () => {
    const merged = mergeActive([
      span(0, 100),
      span(100 + IDLE_GAP_MS, 600), // exactly at the gap → merges
      span(600 + IDLE_GAP_MS + 1, 1200), // past the gap → separate
    ]);
    expect(merged).toEqual([
      [0, 600],
      [600 + IDLE_GAP_MS + 1, 1200],
    ]);
  });

  it("keeps spans past the idle gap apart and sorts inputs", () => {
    const merged = mergeActive([span(2000, 2100), span(0, 100)]);
    expect(merged).toEqual([
      [0, 100],
      [2000, 2100],
    ]);
  });

  it("gives sub-ms spans a minimum 1ms extent", () => {
    expect(mergeActive([span(10, 10)])).toEqual([[10, 11]]);
  });
});

describe("countIdleGutters", () => {
  it("counts gaps before, between, and after active spans", () => {
    const active: Array<[number, number]> = [
      [100, 200],
      [1000, 1100],
    ];
    // Gap before 100 (t0=0), between, and after (t1=2000).
    expect(countIdleGutters(active, 0, 2000)).toBe(3);
    // No leading/trailing gap.
    expect(countIdleGutters(active, 100, 1100)).toBe(1);
  });
});

describe("buildScale / projectX / projectT", () => {
  const active: Array<[number, number]> = [
    [100, 200],
    [1000, 1200],
  ];

  it("gives idle segments a fixed pixel width", () => {
    const model = buildScale(active, 0, 2000, 1);
    const idles = model.segs.filter((s) => s.idle);
    expect(idles).toHaveLength(3);
    for (const s of idles) expect(s.x1 - s.x0).toBe(IDLE_WIDTH);
  });

  it("round-trips t → x → t inside active segments", () => {
    const model = buildScale(active, 0, 2000, 2);
    for (const t of [100, 150, 199, 1000, 1100, 1200]) {
      expect(projectT(model.segs, projectX(model.segs, t))).toBeCloseTo(t, 6);
    }
  });

  it("x is monotone in t", () => {
    const model = buildScale(active, 0, 2000, 0.5);
    let prev = -1;
    for (let t = 0; t <= 2000; t += 25) {
      const x = projectX(model.segs, t);
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it("auto-fit pads to exactly the fill width", () => {
    const model = buildScale(active, 0, 2000, 0.1, 900);
    expect(model.width).toBe(900);
    const last = model.segs.at(-1)!;
    expect(last.x1).toBe(900);
    // Segments stay contiguous after padding.
    for (let i = 1; i < model.segs.length; i++) {
      expect(model.segs[i]!.x0).toBeCloseTo(model.segs[i - 1]!.x1, 6);
    }
  });
});

describe("scaleForProjectedWidth", () => {
  it("finds a scale whose projected range width is within a pixel of target", () => {
    const active: Array<[number, number]> = [
      [0, 500],
      [2000, 2600],
    ];
    const px = scaleForProjectedWidth(active, 0, 3000, 2100, 2500, 640);
    const model = buildScale(active, 0, 3000, px);
    const w = projectX(model.segs, 2500) - projectX(model.segs, 2100);
    expect(Math.abs(w - 640)).toBeLessThanOrEqual(1);
  });
});

describe("sessionBounds", () => {
  it("spans interactions and commits", () => {
    const b = sessionBounds([span(100, 300)], [{ timestamp: 50 }, { timestamp: 900 }]);
    expect(b).toEqual({ t0: 50, t1: 900, span: 850 });
  });

  it("falls back to [0,1] when empty", () => {
    expect(sessionBounds([], [])).toEqual({ t0: 0, t1: 1, span: 1 });
  });
});

describe("stickyLabelShift", () => {
  it("returns 0 while the bar's left edge is visible", () => {
    expect(stickyLabelShift(120, 200, 100)).toBe(0);
  });

  it("follows the scroll once the bar start is hidden", () => {
    expect(stickyLabelShift(100, 200, 130)).toBe(30);
  });

  it("clamps so the label never leaves the bar", () => {
    expect(stickyLabelShift(100, 200, 900)).toBe(200 - 56);
  });
});

describe("clamp / nearest", () => {
  it("clamps into range", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("nearest picks the span with the smallest distance (0 inside)", () => {
    const spans = [span(0, 100), span(500, 600)];
    expect(nearest(spans, 50)).toBe(spans[0]);
    expect(nearest(spans, 350)).toBe(spans[1]);
    expect(nearest([], 10)).toBeNull();
  });
});

describe("fitPlan", () => {
  const active: Array<[number, number]> = [
    [0, 500],
    [2000, 2600],
  ];
  const bounds = { t0: 0, t1: 3000 };

  it("projects the range to ~85% of the port width, centered", () => {
    const plan = fitPlan(active, bounds, { start: 2100, end: 2500 }, 800);
    const model = buildScale(active, bounds.t0, bounds.t1, plan.scale);
    const x0 = projectX(model.segs, 2100);
    const x1 = projectX(model.segs, 2500);
    expect(Math.abs(x1 - x0 - 800 * 0.85)).toBeLessThanOrEqual(1.5);
    expect(plan.scrollLeft).toBeCloseTo(Math.max(0, (x0 + x1) / 2 - 400), 0);
  });

  it("expands a degenerate range to a 16ms context window", () => {
    const plan = fitPlan(active, bounds, { start: 100, end: 100 }, 800);
    const model = buildScale(active, bounds.t0, bounds.t1, plan.scale);
    const w = projectX(model.segs, 108) - projectX(model.segs, 92);
    expect(Math.abs(w - 800 * 0.85)).toBeLessThanOrEqual(1.5);
  });

  it("clamps the range to session bounds", () => {
    const plan = fitPlan(active, bounds, { start: -500, end: 100 }, 800);
    expect(plan.scale).toBeGreaterThan(0);
    expect(plan.scrollLeft).toBeGreaterThanOrEqual(0);
  });
});

describe("clampPaneHeight", () => {
  it("clamps into the allowed waterfall-lane range", () => {
    expect(clampPaneHeight(50)).toBe(PANE_MIN_H);
    expect(clampPaneHeight(9999)).toBe(PANE_MAX_H);
    expect(clampPaneHeight(300)).toBe(300);
  });
});
