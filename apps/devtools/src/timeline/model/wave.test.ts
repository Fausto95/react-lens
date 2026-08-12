import { describe, expect, it } from "vite-plus/test";
import { laneMode, waveBins, WAVE_AVG_PX, WAVE_LOD_MS, avgClipWidthPx } from "./wave.js";
import { VIEW_SPAN_MIN } from "../view/metrics.js";

describe("laneMode", () => {
  it("histograms heavy lanes while marks are still narrow (zoomed out)", () => {
    expect(laneMode(12, 12, 1)).toBe("wave");
    expect(laneMode(5, 100, 8)).toBe("wave");
  });

  it("returns to stacked clips once zoom makes bars readable", () => {
    expect(laneMode(12, 12, WAVE_AVG_PX)).toBe("stack");
    expect(laneMode(12, 12, WAVE_AVG_PX + 10)).toBe("stack");
    expect(laneMode(5, 100, 20)).toBe("stack");
  });

  it("keeps light lanes on clips even when narrow", () => {
    expect(laneMode(1, 10, 1)).toBe("stack");
    expect(laneMode(3, 10, 1)).toBe("stack");
  });

  it("stays reachable at max zoom on a narrow panel plot", () => {
    const narrowPlotW = 360;
    expect(WAVE_LOD_MS * (narrowPlotW / VIEW_SPAN_MIN)).toBeGreaterThanOrEqual(WAVE_AVG_PX);
  });
});

describe("avgClipWidthPx", () => {
  it("grows with pxPerMs so zoom-in progressively favors clips", () => {
    const clips = [{ total: 0.2 }];
    const zoomedOut = avgClipWidthPx(clips, 10);
    const mid = avgClipWidthPx(clips, 40);
    const zoomedIn = avgClipWidthPx(clips, 80);
    expect(zoomedOut).toBeLessThan(mid);
    expect(mid).toBeLessThan(zoomedIn);
    expect(zoomedOut).toBeLessThan(WAVE_AVG_PX);
    expect(zoomedIn).toBeGreaterThanOrEqual(WAVE_AVG_PX);
  });

  it("uses WAVE_LOD_MS floor for tiny painted totals", () => {
    expect(avgClipWidthPx([{ total: 0.05 }], 80)).toBe(WAVE_LOD_MS * 80);
  });
});

describe("waveBins", () => {
  const nameW = 100;
  const stageW = 400;
  const binW = 3;
  const wallToX = (t: number) => nameW + t;

  it("aggregates overlapping exclusive work into columns", () => {
    const { bins, max } = waveBins(
      [
        { t0: 0, t1: 10, self: 10, wasted: false },
        { t0: 0, t1: 10, self: 10, wasted: true },
      ],
      wallToX,
      nameW,
      stageW,
      binW,
    );
    expect(max).toBeGreaterThanOrEqual(2);
    expect(bins.some((b) => b.count >= 2 && b.wasted >= 1)).toBe(true);
  });

  it("bins on self time so inclusive parents do not smear across idle gaps", () => {
    const { bins } = waveBins(
      [
        { t0: 0, t1: 200, self: 5, wasted: false },
        { t0: 150, t1: 160, self: 10, wasted: false },
      ],
      wallToX,
      nameW,
      stageW,
      binW,
    );
    const mid = Math.floor(75 / binW);
    const early = Math.floor(2 / binW);
    const late = Math.floor(155 / binW);
    expect(bins[early]!.count).toBeGreaterThan(0);
    expect(bins[late]!.count).toBeGreaterThan(0);
    expect(bins[mid]!.count).toBe(0);
  });

  it("maps twelve concurrent clips to concurrency height, not twelve stems", () => {
    const clips = Array.from({ length: 12 }, () => ({
      t0: 10,
      t1: 11,
      self: 1,
      wasted: false,
    }));
    const { bins, max } = waveBins(clips, wallToX, nameW, stageW, binW);
    expect(max).toBe(12);
    const active = bins.filter((b) => b.count > 0);
    expect(active.length).toBeLessThan(12);
    expect(active.some((b) => b.count === 12)).toBe(true);
  });

  it("still lights a column for sub-pixel self work", () => {
    const { bins, max } = waveBins(
      [{ t0: 50, t1: 50.01, self: 0.01, wasted: false }],
      wallToX,
      nameW,
      stageW,
      binW,
    );
    expect(max).toBe(1);
    expect(bins.some((b) => b.count === 1)).toBe(true);
  });
});
