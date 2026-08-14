import { describe, expect, it } from "vite-plus/test";
import { packIntervals } from "./stacking.js";

describe("packIntervals", () => {
  it("gives every simultaneously overlapping event its own slot", () => {
    const packed = packIntervals(
      Array.from({ length: 13 }, (_, key) => ({ key, start: 10, end: 20 })),
    );

    expect(packed.depth).toBe(13);
    expect(new Set(packed.slots.values()).size).toBe(13);
  });

  it("reuses a slot only after the previous event has ended", () => {
    const packed = packIntervals([
      { key: "a", start: 0, end: 10 },
      { key: "b", start: 2, end: 8 },
      { key: "c", start: 10, end: 12 },
    ]);

    expect(packed.slots.get("a")).not.toBe(packed.slots.get("b"));
    expect(packed.slots.get("c")).toBe(packed.slots.get("a"));
    expect(packed.depth).toBe(2);
  });
});
