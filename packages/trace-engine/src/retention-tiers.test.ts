import { describe, it, expect } from "vite-plus/test";
import {
  CauseCode,
  TimelineIndex,
  RetentionManager,
  createMemoryColdStore,
  sliceToChunk,
} from "./index.js";

describe("tiered retention", () => {
  it("hotCutoff trails newest by hotMs", () => {
    const mgr = new RetentionManager(createMemoryColdStore(), { hotMs: 1_000 });
    expect(mgr.hotCutoff(5_000)).toBe(4_000);
  });

  it("spills warm chunks to cold when over budget", async () => {
    const cold = createMemoryColdStore();
    const mgr = new RetentionManager(cold, { maxWarmChunks: 1, chunkEvents: 10 });
    const index = new TimelineIndex();
    for (let i = 0; i < 20; i++) {
      index.append({
        timestamp: i * 100,
        duration: 1,
        selfDuration: 1,
        renderId: i + 1,
        componentId: 1,
        commitId: 1,
        cause: CauseCode.props,
        name: "A",
        laneKey: "A",
      });
    }
    const chunk = sliceToChunk({
      t0: 0,
      t1: 500,
      count: index.count,
      timestamps: index.timestamps,
      durations: index.durations,
      selfDurations: index.selfDurations,
      renderIds: index.renderIds,
      componentIds: index.componentIds,
      commitIds: index.commitIds,
      causes: index.causes,
      flags: index.flags,
      laneIndices: index.laneIndices,
      laneOrder: index.laneOrder,
    });
    expect(chunk).not.toBeNull();
    mgr.pushWarm(chunk!);
    mgr.pushWarm({ ...chunk!, t0: 600, t1: 900 });
    const spilled = await mgr.spillWarmToCold();
    expect(spilled).toBe(1);
    expect(mgr.warm).toHaveLength(1);
    const listed = await cold.list();
    expect(listed.length).toBe(1);
  });

  it("loadColdRange returns overlapping chunks", async () => {
    const cold = createMemoryColdStore();
    const mgr = new RetentionManager(cold);
    const id = await cold.put({
      t0: 100,
      t1: 200,
      count: 1,
      timestamps: new Float64Array([100]),
      durations: new Float32Array([1]),
      selfDurations: new Float32Array([1]),
      renderIds: new Uint32Array([1]),
      componentIds: new Uint32Array([1]),
      commitIds: new Uint32Array([1]),
      causes: new Uint8Array([0]),
      flags: new Uint8Array([0]),
      laneKeys: ["A"],
      laneIndices: new Int32Array([0]),
    });
    mgr.coldIds.push({ id, t0: 100, t1: 200 });
    const hit = await mgr.loadColdRange(150, 180);
    expect(hit).toHaveLength(1);
    const miss = await mgr.loadColdRange(300, 400);
    expect(miss).toHaveLength(0);
  });
});
