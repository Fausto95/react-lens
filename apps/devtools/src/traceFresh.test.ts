import { describe, it, expect } from "vite-plus/test";
import { derivationCache } from "./traceFresh.js";

describe("derivation cache", () => {
  it("computes once and reuses the result while the keys hold", () => {
    const cache = derivationCache<number>();
    let calls = 0;
    const compute = () => ++calls;

    expect(cache.read(["store", 1], compute)).toBe(1);
    expect(cache.read(["store", 1], compute)).toBe(1);
    expect(calls).toBe(1);
  });

  it("recomputes when a key changes", () => {
    // The trace store mutates in place, so its identity never moves and only
    // the version says the data did.
    const cache = derivationCache<number>();
    let calls = 0;
    const compute = () => ++calls;

    cache.read(["store", 1], compute);
    expect(cache.read(["store", 2], compute)).toBe(2);
    expect(calls).toBe(2);
  });

  it("recomputes when the key count changes", () => {
    const cache = derivationCache<string>();
    expect(cache.read([1], () => "a")).toBe("a");
    expect(cache.read([1, 2], () => "b")).toBe("b");
  });

  it("compares keys by identity, not by value", () => {
    const cache = derivationCache<number>();
    let calls = 0;
    cache.read([{ muted: [] }], () => ++calls);
    cache.read([{ muted: [] }], () => ++calls);
    expect(calls).toBe(2);
  });

  it("keeps the same result identity across reads that hit", () => {
    const cache = derivationCache<number[]>();
    const first = cache.read(["s", 1], () => [1, 2, 3]);
    expect(cache.read(["s", 1], () => [1, 2, 3])).toBe(first);
  });

  it("treats NaN keys as equal to themselves", () => {
    const cache = derivationCache<number>();
    let calls = 0;
    cache.read([Number.NaN], () => ++calls);
    cache.read([Number.NaN], () => ++calls);
    expect(calls).toBe(1);
  });
});
