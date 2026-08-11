import { describe, it, expect } from "vite-plus/test";
import { buildScale } from "./geometry.js";
import { buildTicks, compactGap, niceStep } from "./ticks.js";

describe("niceStep", () => {
  it("rounds to 1/2/5 × 10^n", () => {
    expect(niceStep(1.2)).toBe(1);
    expect(niceStep(2.9)).toBe(2);
    expect(niceStep(6)).toBe(5);
    expect(niceStep(80)).toBe(100);
    expect(niceStep(0)).toBe(1);
  });
});

describe("buildTicks", () => {
  const active: Array<[number, number]> = [
    [0, 500],
    [3000, 3500],
  ];

  it("labels never sit closer than 40px", () => {
    const model = buildScale(active, 0, 4000, 1);
    const labeled = buildTicks(model.segs, 0).filter((t) => t.label);
    for (let i = 1; i < labeled.length; i++) {
      expect(labeled[i]!.x - labeled[i - 1]!.x).toBeGreaterThanOrEqual(40);
    }
  });

  it("emits boundary ticks for every segment edge", () => {
    const model = buildScale(active, 0, 4000, 1);
    const xs = new Set(buildTicks(model.segs, 0).map((t) => t.x));
    for (const s of model.segs) {
      expect(xs.has(Math.round(s.x0 * 10) / 10)).toBe(true);
      expect(xs.has(Math.round(s.x1 * 10) / 10)).toBe(true);
    }
  });

  it("ticks are sorted by x", () => {
    const model = buildScale(active, 0, 4000, 2);
    const ticks = buildTicks(model.segs, 0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.x).toBeGreaterThanOrEqual(ticks[i - 1]!.x);
    }
  });
});

describe("compactGap", () => {
  it("formats ms, seconds, and minutes", () => {
    expect(compactGap(450)).toBe("450ms");
    expect(compactGap(2400)).toBe("2.4s");
    expect(compactGap(15_000)).toBe("15s");
    expect(compactGap(120_000)).toBe("2m");
  });
});
