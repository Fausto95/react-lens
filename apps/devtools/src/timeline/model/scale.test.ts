import { describe, expect, it } from "vite-plus/test";
import { mergeActive, clamp, IDLE_GAP_MS } from "./scale.js";

describe("scale compatibility re-exports", () => {
  it("merges with IDLE_GAP_MS", () => {
    const merged = mergeActive([
      { start: 0, end: 100 },
      { start: 100 + IDLE_GAP_MS, end: 200 },
    ]);
    expect(merged).toHaveLength(1);
  });

  it("clamps", () => {
    expect(clamp(5, 0, 3)).toBe(3);
  });
});
