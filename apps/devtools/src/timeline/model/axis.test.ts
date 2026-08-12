import { describe, expect, it } from "vite-plus/test";
import {
  buildActivity,
  buildAxis,
  gapAxisLen,
  niceStep,
  compactGap,
} from "./axis.js";

describe("gapAxisLen", () => {
  it("fully compresses idle to zero axis width", () => {
    expect(gapAxisLen(100)).toBe(0);
    expect(gapAxisLen(360_000)).toBe(0);
  });
});

describe("buildActivity", () => {
  it("merges near intervals and pads", () => {
    const acts = buildActivity([
      [100, 150],
      [160, 200],
      [2000, 2100],
    ]);
    expect(acts).toHaveLength(2);
    expect(acts[0]![0]).toBeLessThanOrEqual(100);
    expect(acts[0]![1]).toBeGreaterThanOrEqual(200);
  });

  it("splits when idle exceeds threshold", () => {
    const acts = buildActivity(
      [
        [0, 50],
        [500, 550],
      ],
      200,
    );
    expect(acts).toHaveLength(2);
  });
});

describe("buildAxis", () => {
  const acts: Array<[number, number]> = [
    [100, 300],
    [2000, 2200],
  ];

  it("compresses gaps at progress 0", () => {
    const axis = buildAxis(acts);
    const gap = axis.segs.find((s) => s.type === "gap");
    expect(gap).toBeDefined();
    if (gap?.type === "gap") {
      expect(gap.a1 - gap.a0).toBe(0);
      expect(gap.p).toBe(0);
    }
    // Fully stitched: total axis length is only activity.
    expect(axis.total).toBeCloseTo(200 + 200, 5);
  });

  it("expands gaps toward wall scale at progress 1", () => {
    const collapsed = buildAxis(acts);
    const gap = collapsed.segs.find((s) => s.type === "gap");
    expect(gap?.type).toBe("gap");
    if (gap?.type !== "gap") return;
    const expanded = buildAxis(acts, new Map([[gap.id, 1]]));
    const g2 = expanded.segs.find((s) => s.type === "gap" && s.id === gap.id);
    expect(g2?.type).toBe("gap");
    if (g2?.type === "gap") {
      expect(g2.a1 - g2.a0).toBeCloseTo(g2.w1 - g2.w0, 5);
      expect(expanded.total).toBeGreaterThan(collapsed.total);
    }
  });

  it("round-trips wall ↔ axis on activity", () => {
    const axis = buildAxis(acts);
    // Endpoints that share a zero-width stitch are ambiguous; interiors and
    // the later act's start round-trip cleanly.
    for (const t of [100, 200, 250, 2000, 2100, 2200]) {
      expect(axis.axisToWall(axis.wallToAxis(t))).toBeCloseTo(t, 5);
    }
  });

  it("collapses idle wall times onto the activity stitch", () => {
    const axis = buildAxis(acts);
    const stitch = axis.wallToAxis(2000);
    expect(axis.wallToAxis(1000)).toBeCloseTo(stitch, 5);
    expect(axis.axisToWall(stitch)).toBeCloseTo(2000, 5);
  });
});

describe("niceStep / compactGap", () => {
  it("picks 1-2-5 decades", () => {
    expect(niceStep(3)).toBe(5);
    expect(niceStep(12)).toBe(20);
  });

  it("formats gaps", () => {
    expect(compactGap(80)).toBe("80ms");
    expect(compactGap(1500)).toBe("1.5s");
    expect(compactGap(12_000)).toBe("12s");
  });
});
