import { describe, expect, it } from "vite-plus/test";
import { laneMode, waveBins } from "./wave.js";

describe("laneMode", () => {
  it("uses wave for heavy dense lanes", () => {
    expect(laneMode(5, 100, 3)).toBe("wave");
    expect(laneMode(1, 10, 20)).toBe("stack");
    expect(laneMode(5, 100, 20)).toBe("stack");
  });
});

describe("waveBins", () => {
  it("aggregates overlapping clips into columns", () => {
    const { bins, max } = waveBins(
      [
        { t0: 0, t1: 10, wasted: false },
        { t0: 0, t1: 10, wasted: true },
      ],
      (t) => 100 + t * 2,
      100,
      200,
      3,
    );
    expect(max).toBeGreaterThanOrEqual(2);
    expect(bins.some((b) => b.count >= 2 && b.wasted >= 1)).toBe(true);
  });
});
