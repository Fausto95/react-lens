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

describe("statsInRegion — per instance", () => {
  const id = (n: number) => n as Clip["componentId"];
  /** One type, three instances — the shape that made the tree lie. */
  const shared = lane("t:Insertion", [
    clip({ renderId: 1 as Clip["renderId"], t0: 0, t1: 5, componentId: id(10) }),
    clip({ renderId: 2 as Clip["renderId"], t0: 10, t1: 15, componentId: id(10) }),
    clip({ renderId: 3 as Clip["renderId"], t0: 20, t1: 25, componentId: id(11) }),
    clip({ renderId: 4 as Clip["renderId"], t0: 30, t1: 35, componentId: id(12), wasted: true }),
  ]);

  it("attributes renders to the instance that rendered, not the type", () => {
    // The reported defect: every instance row showed the type's total, so a
    // single <Insertion> in a Chakra app claimed all 1409 of them.
    const { byComponent } = statsInRegion([shared], 0, 100);
    expect(byComponent.get(id(10))?.renders).toBe(2);
    expect(byComponent.get(id(11))?.renders).toBe(1);
    expect(byComponent.get(id(12))?.renders).toBe(1);
  });

  it("still reports the type total, for group and lane rows", () => {
    const stats = statsInRegion([shared], 0, 100);
    expect(stats.byLane.get("t:Insertion" as LaneKey)?.renders).toBe(4);
    // The parts add up to the whole — the two views cannot drift apart.
    const summed = [...stats.byComponent.values()].reduce((n, v) => n + v.renders, 0);
    expect(summed).toBe(stats.renders);
  });

  it("scopes per-instance counts to the region like everything else", () => {
    const { byComponent } = statsInRegion([shared], 0, 12);
    expect(byComponent.get(id(10))?.renders).toBe(2);
    expect(byComponent.has(id(11))).toBe(false);
  });

  it("tracks waste and self time per instance", () => {
    const { byComponent } = statsInRegion([shared], 0, 100);
    expect(byComponent.get(id(12))?.wasted).toBe(1);
    expect(byComponent.get(id(10))?.selfMs).toBe(2);
  });

  it("drops waste from the instance rows under the fix preview too", () => {
    const { byComponent } = statsInRegion([shared], 0, 100, { excludeWasted: true });
    expect(byComponent.has(id(12))).toBe(false);
    expect(byComponent.get(id(10))?.renders).toBe(2);
  });
});
