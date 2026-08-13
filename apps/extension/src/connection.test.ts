import { describe, it, expect } from "vite-plus/test";
import { isContextInvalidated, reconnectDelay, RECONNECT_DELAYS_MS } from "./connection.js";

describe("isContextInvalidated", () => {
  it("recognises the error a reloaded extension throws", () => {
    expect(isContextInvalidated(new Error("Extension context invalidated."))).toBe(true);
    expect(isContextInvalidated("Uncaught Error: Extension context invalidated.")).toBe(true);
  });

  it("recognises a dead receiving end", () => {
    expect(
      isContextInvalidated(
        new Error("Could not establish connection. Receiving end does not exist."),
      ),
    ).toBe(true);
  });

  it("reads Chrome's `runtime.lastError`, which is not an Error", () => {
    // A plain { message } object: stringifying it gives "[object Object]",
    // so a naive String() coercion would never match and the panel would
    // retry a dead context forever.
    expect(isContextInvalidated({ message: "Extension context invalidated." })).toBe(true);
    expect(isContextInvalidated({ message: "The message port closed" })).toBe(false);
  });

  it("treats transient failures as retryable", () => {
    // The worker being asleep is normal MV3 behaviour, not a dead context.
    expect(isContextInvalidated(new Error("The message port closed before a response"))).toBe(
      false,
    );
    expect(isContextInvalidated(new Error("No SW"))).toBe(false);
    expect(isContextInvalidated(undefined)).toBe(false);
  });
});

describe("reconnectDelay", () => {
  it("backs off, then holds at the longest delay (plus jitter)", () => {
    // Jitter is 0..25% of the base, so the result always lands in that band.
    for (const attempt of [0, 2, 99]) {
      const index = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
      const base = RECONNECT_DELAYS_MS[index]!;
      const delay = reconnectDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(base);
      expect(delay).toBeLessThanOrEqual(base + Math.floor(base * 0.25));
    }
  });

  it("clamps a negative attempt rather than returning undefined", () => {
    const base = RECONNECT_DELAYS_MS[0]!;
    const delay = reconnectDelay(-1);
    expect(delay).toBeGreaterThanOrEqual(base);
    expect(delay).toBeLessThanOrEqual(base + Math.floor(base * 0.25));
  });
});
