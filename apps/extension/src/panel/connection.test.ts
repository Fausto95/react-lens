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
  it("backs off, then holds at the longest delay", () => {
    expect(reconnectDelay(0)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelay(2)).toBe(RECONNECT_DELAYS_MS[2]);
    expect(reconnectDelay(99)).toBe(RECONNECT_DELAYS_MS.at(-1));
  });

  it("clamps a negative attempt rather than returning undefined", () => {
    expect(reconnectDelay(-1)).toBe(RECONNECT_DELAYS_MS[0]);
  });
});
