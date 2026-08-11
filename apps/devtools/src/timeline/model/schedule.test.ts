import { describe, it, expect } from "vite-plus/test";
import type { CommitId, ComponentId } from "@reactlens/protocol";
import type { CommitSummary } from "@reactlens/trace-engine";
import {
  advanceReplay,
  replaySchedule,
  replaySpan,
  linearSweep,
  stepStop,
  type ReplayStop,
} from "./schedule.js";

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

describe("replaySpan", () => {
  it("is the whole session when no region is set", () => {
    expect(replaySpan(null, BOUNDS)).toEqual({ lo: 0, hi: 400 });
  });

  it("is the region, normalised, when one is", () => {
    expect(replaySpan({ start: 250, end: 120 }, BOUNDS)).toEqual({ lo: 120, hi: 250 });
  });
});

describe("advanceReplay", () => {
  const stops = replaySchedule(COMMITS, null, BOUNDS);
  const span = replaySpan(null, BOUNDS);
  const along = linearSweep(span);

  /** Runs a whole replay at a given frame count, collecting what was emitted. */
  const sweep = (frames: number) => {
    const emitted: { t: number; live: boolean }[] = [];
    let visited = 0;
    for (let f = 0; f <= frames; f++) {
      const step = advanceReplay(stops, along, f / frames, visited);
      visited = step.visited;
      emitted.push({ t: step.t, live: step.live });
    }
    return emitted;
  };

  it("moves between stops instead of teleporting from one to the next", () => {
    // The defect this fixes: the playhead only ever held commit timestamps, so
    // a four-commit session looked like four jumps rather than playback.
    const emitted = sweep(120);
    const offStop = emitted.filter((e) => !stops.some((s) => s.t === e.t));
    expect(offStop.length).toBeGreaterThan(emitted.length / 2);
  });

  it("never runs backwards", () => {
    let prev = -Infinity;
    for (const { t } of sweep(120)) {
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it("lands on every commit, even when frames are coarser than the commits", () => {
    // Free sweeping alone would step straight over a 5 ms commit; each frame
    // may only advance as far as the next unvisited stop.
    for (const frames of [8, 20, 120]) {
      const seen = new Set(sweep(frames).map((e) => e.t));
      for (const stop of stops) expect(seen.has(stop.t)).toBe(true);
    }
  });

  it("stays inside the span and finishes live", () => {
    const emitted = sweep(120);
    for (const { t } of emitted) {
      expect(t).toBeGreaterThanOrEqual(span.lo);
      expect(t).toBeLessThanOrEqual(span.hi);
    }
    expect(emitted.at(-1)!.live).toBe(true);
  });

  it("reports live only on the closing stop", () => {
    const early = sweep(120).slice(0, -1);
    expect(early.some((e) => e.live)).toBe(false);
  });

  it("holds still on an empty schedule rather than dividing by nothing", () => {
    const step = advanceReplay([], along, 0.5, 0);
    expect(Number.isFinite(step.t)).toBe(true);
    expect(step.visited).toBe(0);
  });
});

describe("linearSweep", () => {
  it("runs the span end to end and clamps outside 0→1", () => {
    const sweep = linearSweep({ lo: 100, hi: 300 });
    expect(sweep(0)).toBe(100);
    expect(sweep(0.5)).toBe(200);
    expect(sweep(1)).toBe(300);
    expect(sweep(-1)).toBe(100);
    expect(sweep(2)).toBe(300);
  });

  it("is the seam a compressed scale replaces", () => {
    // A session that is 90% idle: swept in wall-clock time the playhead spends
    // 90% of the replay inside a 34 px gutter, looking frozen. A screen-uniform
    // sweep crosses the same gap in a proportional slice of the replay.
    const stops = replaySchedule([commit(1, 0), commit(2, 9000)], null, { t0: 0, t1: 9010 });
    const wallClock = linearSweep({ lo: 0, hi: 9010 });
    // Stand-in for the compressed projection: half the screen per active end.
    const screen: (p: number) => number = (p) => (p < 0.5 ? p * 10 : 9000 + (p - 0.5) * 20);

    const inGap = (t: number) => t > 10 && t < 9000;
    const frac = (s: (p: number) => number) => {
      let n = 0;
      for (let f = 0; f <= 1; f += 0.01) {
        if (inGap(advanceReplay(stops, s, f, 2).t)) n++;
      }
      return n / 101;
    };
    expect(frac(wallClock)).toBeGreaterThan(0.9);
    expect(frac(screen)).toBeLessThan(0.1);
  });
});

describe("replaySpan from a playhead", () => {
  it("starts where the playhead was left, not at the beginning", () => {
    // ▶ is labelled "play from playhead" and never was: every replay restarted
    // from the region's start, so parking the ruler mid-session did nothing.
    expect(replaySpan(null, BOUNDS, 180)).toEqual({ lo: 180, hi: 400 });
  });

  it("restarts from the top once the playhead has reached the end", () => {
    // Otherwise ▶ at the end of a session would play a zero-length replay,
    // which reads as the button being broken.
    expect(replaySpan(null, BOUNDS, 400)).toEqual({ lo: 0, hi: 400 });
    expect(replaySpan(null, BOUNDS, 399.9)).toEqual({ lo: 0, hi: 400 });
  });

  it("ignores a playhead outside the region", () => {
    const region = { start: 100, end: 300 };
    expect(replaySpan(region, BOUNDS, 20)).toEqual({ lo: 100, hi: 300 });
    expect(replaySpan(region, BOUNDS, 900)).toEqual({ lo: 100, hi: 300 });
  });

  it("clips the schedule to what is left to play", () => {
    const stops = replaySchedule(COMMITS, null, BOUNDS, 180);
    expect(stops.filter((s) => s.commitId !== null).map((s) => s.commitId)).toEqual([3, 4]);
  });
});

describe("stepStop", () => {
  const stops = replaySchedule(COMMITS, null, BOUNDS);
  const span = replaySpan(null, BOUNDS);
  // Stops land after each commit: 5, 105, 205, 305, then live at 400.

  it("steps forward to the next commit", () => {
    expect(stepStop(stops, span, 0, 1)).toBe(5);
    expect(stepStop(stops, span, 5, 1)).toBe(105);
    expect(stepStop(stops, span, 150, 1)).toBe(205);
  });

  it("steps back to the previous commit", () => {
    expect(stepStop(stops, span, 400, -1)).toBe(305);
    expect(stepStop(stops, span, 205, -1)).toBe(105);
    expect(stepStop(stops, span, 150, -1)).toBe(105);
  });

  it("rewinds to the very start rather than sticking on the first commit", () => {
    // ⏮ from the first commit has nowhere to step, but "back to the top" is
    // what the control is for.
    expect(stepStop(stops, span, 5, -1)).toBe(BOUNDS.t0);
    expect(stepStop(stops, span, 0, -1)).toBe(BOUNDS.t0);
  });

  it("stops at the end going forward", () => {
    expect(stepStop(stops, span, 400, 1)).toBe(400);
    expect(stepStop(stops, span, 305, 1)).toBe(400);
  });

  it("has somewhere to go even with no commits at all", () => {
    const only = replaySchedule([], null, BOUNDS);
    expect(stepStop(only, span, 200, 1)).toBe(400);
    expect(stepStop(only, span, 200, -1)).toBe(0);
  });
});
