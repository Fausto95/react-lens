import { describe, it, expect } from "vite-plus/test";
import { CauseCode, RenderFlags, TimelineIndex, lowerBound, upperBound } from "./columnar.js";
import { hitTest, queryTimeline, statsInRange } from "./aggregates.js";

function appendMany(index: TimelineIndex, n: number, lane = "App", start = 0): void {
  for (let i = 0; i < n; i++) {
    index.append({
      timestamp: start + i,
      duration: 0.5,
      selfDuration: 0.4,
      renderId: start * 1000 + i + 1,
      componentId: 1,
      commitId: i + 1,
      cause: CauseCode.props,
      name: lane,
      laneKey: lane,
    });
  }
}

describe("columnar TimelineIndex", () => {
  it("appends into typed arrays without Clip objects", () => {
    const index = new TimelineIndex();
    appendMany(index, 10);
    expect(index.count).toBe(10);
    expect(index.lanes.get("App")?.count).toBe(10);
    expect(index.bounds().t0).toBe(0);
    expect(index.bounds().t1).toBeGreaterThan(9);
  });

  it("binary-searches timestamps in O(log n)", () => {
    const ts = new Float64Array([1, 3, 5, 7, 9]);
    expect(lowerBound(ts, 5, 5)).toBe(2);
    expect(lowerBound(ts, 5, 6)).toBe(3);
    expect(upperBound(ts, 5, 5)).toBe(3);
    expect(upperBound(ts, 5, 9)).toBe(5);
  });

  it("prefix-sum stats match a naive scan", () => {
    const index = new TimelineIndex();
    for (let i = 0; i < 100; i++) {
      index.append({
        timestamp: i * 10,
        duration: 2,
        selfDuration: 1.5,
        renderId: i + 1,
        componentId: 1,
        commitId: i + 1,
        cause: CauseCode.state,
        flags: i % 5 === 0 ? RenderFlags.Wasted : RenderFlags.None,
        name: "Card",
        laneKey: "Card",
      });
    }
    const t0 = 100;
    const t1 = 400;
    const fast = statsInRange(index, t0, t1);
    const lane = index.lanes.get("Card")!;
    let renders = 0;
    let wasted = 0;
    let selfMs = 0;
    for (let i = 0; i < lane.count; i++) {
      const t = lane.timestamps[i]!;
      if (t < t0 || t > t1) continue;
      renders++;
      if (lane.flags[i]! & RenderFlags.Wasted) wasted++;
      selfMs += lane.selfDurations[i]!;
    }
    expect(fast.renders).toBe(renders);
    expect(fast.wasted).toBe(wasted);
    expect(fast.selfMs).toBeCloseTo(selfMs, 5);
  });

  it("setFlag updates wasted without rebuilding the session", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 10,
      duration: 1,
      selfDuration: 1,
      renderId: 42,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      name: "A",
      laneKey: "A",
    });
    expect(statsInRange(index, 0, 100).wasted).toBe(0);
    index.setFlag(42, RenderFlags.Wasted, true);
    expect(statsInRange(index, 0, 100).wasted).toBe(1);
    expect(index.flags[0]! & RenderFlags.Wasted).toBeTruthy();
  });

  it("subtracts wasted self time exactly when excluded", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 0,
      duration: 5,
      selfDuration: 2,
      renderId: 1,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      flags: RenderFlags.Wasted,
      name: "A",
      laneKey: "A",
    });
    index.append({
      timestamp: 10,
      duration: 5,
      selfDuration: 7,
      renderId: 2,
      componentId: 1,
      commitId: 2,
      cause: CauseCode.state,
      name: "A",
      laneKey: "A",
    });

    const stats = statsInRange(index, 0, 20, { excludeWasted: true });
    expect(stats.renders).toBe(1);
    expect(stats.wasted).toBe(0);
    expect(stats.selfMs).toBe(7);
  });

  it("hitTest finds a containing clip via binary search neighborhood", () => {
    const index = new TimelineIndex();
    appendMany(index, 200);
    const hit = hitTest(index, 50.2);
    expect(hit).not.toBeNull();
    expect(hit!.t0).toBeLessThanOrEqual(50.2);
    expect(hit!.t1).toBeGreaterThanOrEqual(50.2);
  });

  it("queryTimeline returns a viewport-sized raw slice", () => {
    const index = new TimelineIndex();
    appendMany(index, 5_000);
    const result = queryTimeline(index, {
      t0: 100,
      t1: 200,
      rowStart: 0,
      rowEnd: 10,
      pixelWidth: 1400,
    });
    expect(result.lod).toBe("raw");
    expect(result.columns).not.toBeNull();
    expect(result.columns!.count).toBeLessThanOrEqual(200);
    expect(result.columns!.count).toBeGreaterThan(0);
  });

  it("queryTimeline switches to LOD buckets when zoomed out", () => {
    const index = new TimelineIndex();
    appendMany(index, 10_000, "App", 0);
    const result = queryTimeline(index, {
      t0: 0,
      t1: 10_000,
      rowStart: 0,
      rowEnd: 10,
      pixelWidth: 400,
      lodEnterPx: 1,
    });
    expect(result.lod).toBe("buckets");
    expect(result.buckets).not.toBeNull();
    expect(result.buckets!.count).toBeLessThan(10_000);
    expect(result.buckets!.count).toBeLessThanOrEqual(10_000);
  });

  it("query cost stays bounded as N grows (same viewport)", () => {
    const small = new TimelineIndex();
    const large = new TimelineIndex();
    appendMany(small, 1_000);
    appendMany(large, 50_000);
    const q = { t0: 100, t1: 150, rowStart: 0, rowEnd: 5, pixelWidth: 800 };
    const a = queryTimeline(small, q);
    const b = queryTimeline(large, q);
    expect(a.columns!.count).toBeGreaterThan(0);
    // Same 50ms window → similar visible counts regardless of total N.
    expect(Math.abs(a.columns!.count - b.columns!.count)).toBeLessThan(5);
  });

  it("assigns stack rows incrementally", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 0,
      duration: 10,
      selfDuration: 1,
      renderId: 1,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      name: "X",
      laneKey: "X",
    });
    index.append({
      timestamp: 2,
      duration: 10,
      selfDuration: 1,
      renderId: 2,
      componentId: 2,
      commitId: 1,
      cause: CauseCode.props,
      name: "X",
      laneKey: "X",
    });
    const lane = index.lanes.get("X")!;
    expect(lane.rows[0]).toBe(0);
    expect(lane.rows[1]).toBe(1);
    expect(lane.maxRow).toBe(1);
  });
});
