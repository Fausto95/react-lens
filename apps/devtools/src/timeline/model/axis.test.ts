import { describe, expect, it } from "vite-plus/test";
import {
  buildActivity,
  buildAxis,
  gapAxisLen,
  niceStep,
  compactGap,
} from "./axis.js";

describe("gapAxisLen", () => {
  it("grows with idle duration but stays bounded", () => {
    expect(gapAxisLen(100)).toBeGreaterThanOrEqual(26);
    expect(gapAxisLen(10_000)).toBeLessThanOrEqual(110);
    expect(gapAxisLen(10_000)).toBeGreaterThan(gapAxisLen(200));
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
      expect(gap.a1 - gap.a0).toBeCloseTo(gapAxisLen(gap.w1 - gap.w0), 5);
      expect(gap.p).toBe(0);
    }
    expect(axis.total).toBeLessThan(2100);
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
    for (const t of [100, 200, 300, 2000, 2100, 2200]) {
      expect(axis.axisToWall(axis.wallToAxis(t))).toBeCloseTo(t, 5);
    }
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
