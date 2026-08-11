import { describe, expect, it } from "vite-plus/test";
import { clipAtTime, statsInRegion, type Clip, type Lane } from "./lanes.js";
import type { LaneKey } from "../../laneFilter.js";

function clip(partial: Partial<Clip> & Pick<Clip, "renderId" | "t0" | "t1">): Clip {
  return {
    componentId: 1 as Clip["componentId"],
    laneKey: "t:Foo" as LaneKey,
    name: "Foo",
    self: 1,
    cause: "props",
    wasted: false,
    ...partial,
  };
}

function lane(key: string, clips: Clip[]): Lane {
  return {
    key: key as LaneKey,
    name: key.slice(2),
    instanceCount: 1,
    clips,
    subs: [],
    renders: clips.length,
    wasted: clips.filter((c) => c.wasted).length,
    selfTotal: clips.reduce((n, c) => n + c.self, 0),
    firstT: clips[0]?.t0 ?? 0,
    density: [],
  };
}

describe("clipAtTime", () => {
  const lanes = [
    lane("t:A", [
      clip({ renderId: 1 as Clip["renderId"], t0: 100, t1: 120, laneKey: "t:A" as LaneKey }),
    ]),
    lane("t:B", [
      clip({ renderId: 2 as Clip["renderId"], t0: 110, t1: 140, laneKey: "t:B" as LaneKey }),
      clip({
        renderId: 3 as Clip["renderId"],
        t0: 200,
        t1: 210,
        laneKey: "t:B" as LaneKey,
        wasted: true,
      }),
    ]),
  ];

  it("prefers a clip that contains the playhead", () => {
    expect(clipAtTime(lanes, 130)?.renderId).toBe(2);
  });

  it("prefers the selected lane when several contain t", () => {
    expect(clipAtTime(lanes, 115, "t:A" as LaneKey)?.renderId).toBe(1);
  });

  it("returns null when nothing is near the playhead", () => {
    expect(clipAtTime(lanes, 5000)).toBeNull();
  });
});

describe("statsInRegion", () => {
  const lanes = [
    lane("t:A", [
      clip({ renderId: 1 as Clip["renderId"], t0: 100, t1: 110, self: 4 }),
      clip({ renderId: 2 as Clip["renderId"], t0: 120, t1: 130, self: 6, wasted: true }),
    ]),
  ];

  it("counts overlapping clips", () => {
    const stats = statsInRegion(lanes, 105, 125);
    expect(stats.renders).toBe(2);
    expect(stats.wasted).toBe(1);
    expect(stats.byLane.get("t:A" as LaneKey)?.renders).toBe(2);
  });

  it("excludes wasted clips when replaying a fix", () => {
    const stats = statsInRegion(lanes, 100, 200, { excludeWasted: true });
    expect(stats.renders).toBe(1);
    expect(stats.wasted).toBe(0);
    expect(stats.selfMs).toBe(4);
  });
});
