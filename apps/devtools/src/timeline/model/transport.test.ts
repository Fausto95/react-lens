import { describe, expect, it } from "vite-plus/test";
import {
  advancePlayhead,
  playStartAxis,
  cursorModeAtStop,
  stepCommitTime,
} from "./transport.js";

describe("advancePlayhead", () => {
  it("loops inside an A/B region", () => {
    expect(
      advancePlayhead({ a: 90, deltaA: 20, a0: 0, a1: 100, loop: true }),
    ).toEqual({ kind: "continue", a: 0 });
    expect(
      advancePlayhead({ a: 10, deltaA: -20, a0: 0, a1: 100, loop: true }),
    ).toEqual({ kind: "continue", a: 100 });
  });

  it("stops at the end when no loop region is set", () => {
    // Without an intentional A/B band, play-once should not wrap the session.
    expect(
      advancePlayhead({ a: 90, deltaA: 20, a0: 0, a1: 100, loop: false }),
    ).toEqual({ kind: "stop", a: 100 });
    expect(
      advancePlayhead({ a: 10, deltaA: -20, a0: 0, a1: 100, loop: false }),
    ).toEqual({ kind: "stop", a: 0 });
  });

  it("keeps moving while inside the range", () => {
    expect(
      advancePlayhead({ a: 40, deltaA: 10, a0: 0, a1: 100, loop: false }),
    ).toEqual({ kind: "continue", a: 50 });
    expect(
      advancePlayhead({ a: 40, deltaA: 10, a0: 0, a1: 100, loop: true }),
    ).toEqual({ kind: "continue", a: 50 });
  });
});

describe("cursorModeAtStop", () => {
  it("lands live after playing forward to the present", () => {
    // A historical cursor keeps time travel applied, and the page drops every
    // commit while it is — so a finished play-once silently killed capture.
    expect(cursorModeAtStop({ dir: 1, loop: false })).toBe("live");
  });

  it("stays historical when play-once ends at the start of the session", () => {
    expect(cursorModeAtStop({ dir: -1, loop: false })).toBe("historical");
  });

  it("stays historical inside an A/B region", () => {
    // Looping playback is an explicit request to sit in the past.
    expect(cursorModeAtStop({ dir: 1, loop: true })).toBe("historical");
  });
});

describe("playStartAxis", () => {
  it("restarts from the start when play is pressed at the end", () => {
    expect(playStartAxis({ a: 100, a0: 0, a1: 100, dir: 1 })).toBe(0);
    expect(playStartAxis({ a: 0, a0: 0, a1: 100, dir: -1 })).toBe(100);
  });

  it("keeps the cursor when it still has room to travel", () => {
    expect(playStartAxis({ a: 40, a0: 0, a1: 100, dir: 1 })).toBe(40);
    expect(playStartAxis({ a: 40, a0: 0, a1: 100, dir: -1 })).toBe(40);
  });

  it("enters an A/B region from the near edge when the cursor is outside", () => {
    expect(playStartAxis({ a: -10, a0: 20, a1: 80, dir: 1 })).toBe(20);
    // Past the out point while playing forward → restart at in, not freeze at out.
    expect(playStartAxis({ a: 200, a0: 20, a1: 80, dir: 1 })).toBe(20);
    expect(playStartAxis({ a: 200, a0: 20, a1: 80, dir: -1 })).toBe(80);
  });
});

describe("stepCommitTime", () => {
  const commits = [{ timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }];

  it("steps to the next / previous commit", () => {
    expect(stepCommitTime(commits, 15, 1)).toBe(20);
    expect(stepCommitTime(commits, 15, -1)).toBe(10);
  });

  it("returns null at the ends", () => {
    expect(stepCommitTime(commits, 30, 1)).toBeNull();
    expect(stepCommitTime(commits, 10, -1)).toBeNull();
  });

  it("from live (past the last commit) steps back to the last", () => {
    expect(stepCommitTime(commits, 100, -1)).toBe(30);
  });
});
