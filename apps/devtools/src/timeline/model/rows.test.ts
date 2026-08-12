import { describe, expect, it } from "vite-plus/test";
import { computeLayout, isQuietLane } from "./rows.js";
import type { Clip, Lane } from "./lanes.js";
import type { LaneKey } from "../../laneFilter.js";
import { QUIET_MAX, QUIET_TOTAL_MS, RULER_H, WAVE_H, LANE_PAD, ROW_H } from "../view/metrics.js";

function lane(
  name: string,
  n: number,
  opts?: { heavy?: boolean; total?: number; self?: number },
): Lane {
  const total = opts?.total ?? (opts?.heavy ? 0.2 : 10);
  const self = opts?.self ?? (opts?.heavy ? 0.2 : 1);
  const clips: Clip[] = Array.from({ length: n }, (_, i) => ({
    renderId: i as Clip["renderId"],
    componentId: i as Clip["componentId"],
    laneKey: `t:${name}` as LaneKey,
    name,
    t0: i * 0.5,
    t1: i * 0.5 + total,
    self,
    total,
    cause: "props" as const,
    wasted: false,
    row: 0,
  }));
  return {
    key: `t:${name}` as LaneKey,
    name,
    instanceCount: Math.max(1, n),
    clips,
    renders: n,
    wasted: 0,
    selfTotal: self * n,
    firstT: 0,
  };
}

describe("isQuietLane", () => {
  it("tucks sparse low-total lanes", () => {
    expect(isQuietLane(lane("Tip", 1, { total: 1, self: 1 }))).toBe(true);
    expect(isQuietLane(lane("Busy", QUIET_MAX + 1))).toBe(false);
  });

  it("quiets context fanout leaves with many tiny renders", () => {
    // Consumer ×4 — clip count exceeds QUIET_MAX but total work is negligible.
    expect(isQuietLane(lane("Consumer", 4, { heavy: true, total: 0.05, self: 0 }))).toBe(true);
  });

  it("keeps sparse cascade roots that have real inclusive work", () => {
    // App rendered once but totalDuration covers the cascade — not quiet.
    expect(isQuietLane(lane("App", 1, { total: 40, self: 0.2 }))).toBe(false);
    expect(QUIET_TOTAL_MS).toBeLessThan(40);
  });

  it("still quiets two tiny renders under the budget", () => {
    expect(isQuietLane(lane("Analytics", 2, { total: 2, self: 2 }))).toBe(true);
  });
});

describe("computeLayout", () => {
  it("hides quiet lanes when the shelf is closed", () => {
    const lanes = [lane("Quiet", 1, { total: 1 }), lane("Busy", 10)];
    const depth = new Map([
      ["t:Quiet", 1],
      ["t:Busy", 1],
    ]);
    const closed = computeLayout(lanes, depth, {
      shelfOpen: false,
      pxPerMs: 2,
      isDim: () => false,
    });
    expect(closed.rows.map((r) => r.lane.name)).toEqual(["Busy"]);
    expect(closed.quietLanes).toHaveLength(1);

    const open = computeLayout(lanes, depth, {
      shelfOpen: true,
      pxPerMs: 2,
      isDim: () => false,
    });
    expect(open.rows).toHaveLength(2);
  });

  it("does not shelf an inclusive cascade root just because it rendered once", () => {
    const lanes = [lane("App", 1, { total: 50, self: 0.1 }), lane("Busy", 10)];
    const depth = new Map([
      ["t:App", 1],
      ["t:Busy", 1],
    ]);
    const closed = computeLayout(lanes, depth, {
      shelfOpen: false,
      pxPerMs: 2,
      isDim: () => false,
    });
    expect(closed.rows.map((r) => r.lane.name)).toEqual(["App", "Busy"]);
    expect(closed.quietLanes).toHaveLength(0);
  });

  it("grows stack lane height with uncapped depth", () => {
    // Wide clips stay in stack mode (wave is for dense+narrow). Depth 6 must
    // expand the lane — not clamp at STACK_MAX=4.
    const busy = lane("Busy", 3, { total: 40, self: 40 });
    const depth = new Map([[busy.key, 6]]);
    const layout = computeLayout([busy], depth, {
      shelfOpen: true,
      pxPerMs: 2,
      isDim: () => false,
    });
    expect(layout.rows[0]!.mode).toBe("stack");
    expect(layout.rows[0]!.h).toBe(LANE_PAD + 6 * ROW_H);
  });

  it("switches dense lanes to wave when zoomed out", () => {
    const heavy = lane("List", 80, { heavy: true });
    const depth = new Map([[heavy.key, 5]]);
    const layout = computeLayout([heavy], depth, {
      shelfOpen: true,
      pxPerMs: 1, // narrow marks → wave
      isDim: () => false,
    });
    expect(layout.rows[0]!.mode).toBe("wave");
    expect(layout.rows[0]!.h).toBe(WAVE_H);
    expect(layout.totalH).toBeGreaterThan(RULER_H);
  });

  it("leaves wave for stack once zoom makes clips readable", () => {
    const busy = lane("Product", 12, { heavy: true, total: 0.05, self: 0 });
    const depth = new Map([[busy.key, 12]]);
    // WAVE_LOD_MS * 80 = 16 ≥ WAVE_AVG_PX at max zoom.
    const layout = computeLayout([busy], depth, {
      shelfOpen: true,
      pxPerMs: 80,
      isDim: () => false,
    });
    expect(layout.rows[0]!.mode).toBe("stack");
  });

  it("stays on wave at moderate zoom where marks are still narrow", () => {
    const busy = lane("Consumer", 12, { heavy: true, total: 0.05, self: 0 });
    const depth = new Map([[busy.key, 12]]);
    // WAVE_LOD_MS * 40 = 8 < WAVE_AVG_PX → still histogram.
    const layout = computeLayout([busy], depth, {
      shelfOpen: true,
      pxPerMs: 40,
      isDim: () => false,
    });
    expect(layout.rows[0]!.mode).toBe("wave");
  });

  it("flips wide heavy lanes to clips before narrow ones when zooming in", () => {
    const narrow = lane("Consumer", 12, { heavy: true, total: 0.05, self: 0 });
    const wide = lane("List", 80, { heavy: true, total: 2, self: 0.2 });
    const depth = new Map([
      [narrow.key, 12],
      [wide.key, 5],
    ]);
    const layout = computeLayout([narrow, wide], depth, {
      shelfOpen: true,
      pxPerMs: 10,
      isDim: () => false,
    });
    expect(layout.rows.find((r) => r.lane.name === "List")!.mode).toBe("stack");
    expect(layout.rows.find((r) => r.lane.name === "Consumer")!.mode).toBe("wave");
  });

  it("histograms ×12 lanes while still zoomed out", () => {
    const busy = lane("Product", 12, { heavy: true, total: 0.05, self: 0 });
    const depth = new Map([[busy.key, 12]]);
    const layout = computeLayout([busy], depth, {
      shelfOpen: true,
      pxPerMs: 1,
      isDim: () => false,
    });
    expect(layout.rows[0]!.mode).toBe("wave");
  });
});
