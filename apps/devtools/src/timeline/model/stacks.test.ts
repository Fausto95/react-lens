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

  it("caps row at STACK_MAX - 1", () => {
    const clips: Stackable[] = Array.from({ length: 8 }, (_, i) => ({
      t0: i * 5,
      t1: i * 5 + 40,
    }));
    stackLane(clips, 4);
    expect(Math.max(...clips.map((c) => c.row!))).toBe(3);
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
