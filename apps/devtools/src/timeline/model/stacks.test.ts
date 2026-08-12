import { describe, expect, it } from "vite-plus/test";
import { assignStacks, stackLane, type Stackable } from "./stacks.js";

describe("assignStacks", () => {
  it("stacks overlapping clips", () => {
    const clips: Stackable[] = [
      { t0: 0, t1: 50 },
      { t0: 25, t1: 75 },
      { t0: 60, t1: 100 },
    ];
    const depth = assignStacks(new Map([["A", clips]]));
    expect(depth.get("A")).toBe(2);
    expect(clips[0]!.row).toBe(0);
    expect(clips[1]!.row).toBe(1);
    expect(clips[2]!.row).toBe(0);
  });

  it("never reuses a row for concurrent clips — always columnar", () => {
    // Former STACK_MAX clamp painted depth>4 on the same Y. Eight mutually
    // overlapping clips must get rows 0..7.
    const clips: Stackable[] = Array.from({ length: 8 }, (_, i) => ({
      t0: i * 5,
      t1: i * 5 + 40,
    }));
    const depth = stackLane(clips);
    expect(depth).toBe(8);
    expect(new Set(clips.map((c) => c.row)).size).toBe(8);
    expect(Math.max(...clips.map((c) => c.row!))).toBe(7);
  });

  it("keeps non-overlapping clips on row 0", () => {
    const clips: Stackable[] = [
      { t0: 0, t1: 10 },
      { t0: 20, t1: 30 },
    ];
    expect(stackLane(clips)).toBe(1);
    expect(clips.every((c) => c.row === 0)).toBe(true);
  });
});
