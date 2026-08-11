import { describe, it, expect } from "vite-plus/test";
import type { CommitId, ComponentId } from "@reactlens/protocol";
import type { CommitSummary } from "@reactlens/trace-engine";
import { replaySchedule, stopIndexAt, type ReplayStop } from "./schedule.js";

const commit = (id: number, t: number, dur = 5): CommitSummary => ({
  commitId: id as CommitId,
  timestamp: t,
  endTimestamp: t + dur,
  totalSelfTime: dur,
  componentIds: [1 as ComponentId],
});

/** Mount, then three counter bumps — the shape of the flagship journey. */
const COMMITS = [commit(1, 0), commit(2, 100), commit(3, 200), commit(4, 300)];
const BOUNDS = { t0: 0, t1: 400 };

const times = (stops: ReplayStop[]) => stops.map((s) => s.t);

describe("replaySchedule", () => {
  it("emits one stop per commit, in order, then a final live stop", () => {
    const stops = replaySchedule(COMMITS, null, BOUNDS);
    expect(stops).toHaveLength(COMMITS.length + 1);
    expect(times(stops)).toEqual([...times(stops)].sort((a, b) => a - b));
    expect(stops.at(-1)!.live).toBe(true);
    expect(stops.slice(0, -1).every((s) => !s.live)).toBe(true);
  });

  it("stops AFTER each commit, so the page shows that commit's result", () => {
    // Landing on `timestamp` would show the state going in, not the outcome —
    // the replay would appear to lag one step behind the whole way.
    const stops = replaySchedule(COMMITS, null, BOUNDS);
    expect(stops[0]!.t).toBe(COMMITS[0]!.endTimestamp);
    expect(stops[1]!.t).toBe(COMMITS[1]!.endTimestamp);
  });

  it("visits every commit exactly once — no state is skipped or repeated", () => {
    const ids = replaySchedule(COMMITS, null, BOUNDS)
      .filter((s) => s.commitId !== null)
      .map((s) => s.commitId);
    expect(ids).toEqual([1, 2, 3, 4]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("restricts to the region when one is set", () => {
    const stops = replaySchedule(COMMITS, { start: 90, end: 250 }, BOUNDS);
    expect(stops.filter((s) => s.commitId !== null).map((s) => s.commitId)).toEqual([2, 3]);
    expect(stops.at(-1)!.live).toBe(true);
  });

  it("counts a commit straddling the region edge", () => {
    const stops = replaySchedule(COMMITS, { start: 102, end: 250 }, BOUNDS);
    // Commit 2 runs 100..105, so it overlaps a region starting at 102.
    expect(stops.filter((s) => s.commitId !== null).map((s) => s.commitId)).toContain(2);
  });

  it("degrades to a single live stop when there is nothing to replay", () => {
    expect(replaySchedule([], null, BOUNDS)).toEqual([
      { t: BOUNDS.t1, commitId: null, live: true },
    ]);
    const empty = replaySchedule(COMMITS, { start: 320, end: 340 }, BOUNDS);
    expect(empty.filter((s) => s.commitId !== null)).toHaveLength(0);
  });

  it("ends live at the region's end, not the session's, when scoped", () => {
    const stops = replaySchedule(COMMITS, { start: 90, end: 250 }, BOUNDS);
    expect(stops.at(-1)!.t).toBe(250);
  });

  it("ignores commits recorded out of order", () => {
    const shuffled = [COMMITS[2]!, COMMITS[0]!, COMMITS[3]!, COMMITS[1]!];
    expect(times(replaySchedule(shuffled, null, BOUNDS))).toEqual(
      times(replaySchedule(COMMITS, null, BOUNDS)),
    );
  });
});

describe("stopIndexAt", () => {
  const stops = replaySchedule(COMMITS, null, BOUNDS);

  it("walks the stops from first to last as progress runs 0→1", () => {
    expect(stopIndexAt(stops, 0)).toBe(0);
    expect(stopIndexAt(stops, 1)).toBe(stops.length - 1);
  });

  it("is monotonic, so replay never jumps backwards mid-sweep", () => {
    let prev = -1;
    for (let f = 0; f <= 1; f += 0.02) {
      const i = stopIndexAt(stops, f);
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
    }
  });

  it("clamps out-of-range progress instead of indexing past the end", () => {
    expect(stopIndexAt(stops, -5)).toBe(0);
    expect(stopIndexAt(stops, 99)).toBe(stops.length - 1);
  });

  it("gives every stop a turn — none is stepped over", () => {
    const seen = new Set<number>();
    for (let f = 0; f <= 1; f += 0.001) seen.add(stopIndexAt(stops, f));
    expect(seen.size).toBe(stops.length);
  });
});
