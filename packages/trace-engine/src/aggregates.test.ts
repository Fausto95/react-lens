import { describe, it, expect } from "vite-plus/test";
import { CauseCode, TimelineIndex } from "./columnar.js";
import { activityIntervals, queryTimeline, statsInRange } from "./aggregates.js";

describe("aggregates", () => {
  it("activityIntervals merges busy LOD buckets", () => {
    const index = new TimelineIndex();
    for (let i = 0; i < 20; i++) {
      index.append({
        timestamp: i * 10,
        duration: 5,
        selfDuration: 5,
        renderId: i + 1,
        componentId: 1,
        commitId: i + 1,
        cause: CauseCode.props,
        name: "A",
        laneKey: "A",
      });
    }
    const acts = activityIntervals(index, 64);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts[0]![0]).toBeLessThanOrEqual(0);
  });

  it("statsInRange with includeLane filters", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 1,
      duration: 1,
      selfDuration: 1,
      renderId: 1,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      name: "A",
      laneKey: "A",
    });
    index.append({
      timestamp: 2,
      duration: 1,
      selfDuration: 1,
      renderId: 2,
      componentId: 2,
      commitId: 1,
      cause: CauseCode.props,
      name: "B",
      laneKey: "B",
    });
    const onlyA = statsInRange(index, 0, 10, {
      includeLane: (k) => k === "A",
    });
    expect(onlyA.renders).toBe(1);
  });

  it("queryTimeline honors serializable lane filters", () => {
    const index = new TimelineIndex();
    for (const name of ["A", "B"]) {
      index.append({
        timestamp: name === "A" ? 1 : 2,
        duration: 1,
        selfDuration: 1,
        renderId: name.charCodeAt(0),
        componentId: name.charCodeAt(0),
        commitId: 1,
        cause: CauseCode.props,
        name,
        laneKey: `t:${name}`,
      });
    }

    const result = queryTimeline(index, {
      t0: 0,
      t1: 10,
      rowStart: 0,
      rowEnd: 10,
      pixelWidth: 1000,
      laneFilter: { solo: ["t:A"], muted: [] },
    });

    expect(result.rows.map((row) => row.laneKey)).toEqual(["t:A"]);
    expect(result.totalRows).toBe(1);
    expect(result.stats.renders).toBe(1);
  });

  it("row window slices ordered lanes", () => {
    const index = new TimelineIndex();
    for (const name of ["Z", "A", "M"]) {
      index.append({
        timestamp: name === "A" ? 0 : name === "M" ? 1 : 2,
        duration: 1,
        selfDuration: 1,
        renderId: name.charCodeAt(0),
        componentId: name.charCodeAt(0),
        commitId: 1,
        cause: CauseCode.mount,
        name,
        laneKey: name,
      });
    }
    const result = queryTimeline(index, {
      t0: 0,
      t1: 10,
      rowStart: 0,
      rowEnd: 1,
      pixelWidth: 1000,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.name).toBe("A"); // firstT sort
  });

  it("queryTimeline can skip unused activity and stats", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 1,
      duration: 5,
      selfDuration: 5,
      renderId: 1,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      name: "A",
      laneKey: "A",
    });

    const result = queryTimeline(index, {
      t0: 0,
      t1: 10,
      rowStart: 0,
      rowEnd: 10,
      pixelWidth: 1000,
      includeStats: false,
      includeActivity: false,
    });

    expect(result.stats).toEqual({ renders: 0, wasted: 0, selfMs: 0 });
    expect(result.activity).toEqual([]);
  });

  it("queryTimeline can row-window nonquiet lanes", () => {
    const index = new TimelineIndex();
    index.append({
      timestamp: 0,
      duration: 1,
      selfDuration: 1,
      renderId: 1,
      componentId: 1,
      commitId: 1,
      cause: CauseCode.props,
      name: "Quiet",
      laneKey: "Quiet",
    });
    index.append({
      timestamp: 1,
      duration: 20,
      selfDuration: 1,
      renderId: 2,
      componentId: 2,
      commitId: 1,
      cause: CauseCode.props,
      name: "Busy",
      laneKey: "Busy",
    });

    const result = queryTimeline(index, {
      t0: 0,
      t1: 30,
      rowStart: 0,
      rowEnd: 10,
      pixelWidth: 1000,
      includeQuiet: false,
    });

    expect(result.rows.map((row) => row.name)).toEqual(["Busy"]);
    expect(result.totalRows).toBe(1);
    expect(result.quietSummary).toMatchObject({ lanes: 1, renders: 1 });
  });
});
