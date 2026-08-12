import { describe, it, expect, beforeEach } from "vite-plus/test";
import {
  clearErrors,
  installGlobalErrorHandlers,
  lensErrors,
  reportError,
  reportNotice,
  subscribeErrors,
  ERROR_RING_MAX,
  type ErrorEventTarget,
  type ErrorLikeEvent,
} from "./errors.js";

beforeEach(() => {
  clearErrors();
});

describe("panel error seam", () => {
  it("records what failed and where, newest last", () => {
    reportError("timeline", new Error("bad clip"));
    reportError("inspector", new Error("no snapshot"));

    expect(lensErrors().map((e) => [e.scope, e.message])).toEqual([
      ["timeline", "bad clip"],
      ["inspector", "no snapshot"],
    ]);
  });

  it("accepts non-Error throws without losing the report", () => {
    reportError("transport", "port died");
    reportError("transport", { nope: true });

    expect(lensErrors().map((e) => e.message)).toEqual(["port died", "[object Object]"]);
  });

  it("collapses a repeating failure into one entry with a count", () => {
    // A derivation that throws every frame must not flood the ring and evict
    // the one report that explains it.
    for (let i = 0; i < 5; i++) reportError("timeline", new Error("bad clip"));

    expect(lensErrors()).toHaveLength(1);
    expect(lensErrors()[0]!.count).toBe(5);
  });

  it("keeps the newest reports when the ring overflows", () => {
    for (let i = 0; i < ERROR_RING_MAX + 3; i++) reportError("scope", new Error(`e${i}`));

    const errors = lensErrors();
    expect(errors).toHaveLength(ERROR_RING_MAX);
    expect(errors[errors.length - 1]!.message).toBe(`e${ERROR_RING_MAX + 2}`);
  });

  it("hands subscribers an identity-stable snapshot", () => {
    // Read sites memoize on this identity under the React Compiler: it must
    // change when a report lands and only then.
    const seen: Array<readonly unknown[]> = [];
    subscribeErrors((errors) => seen.push(errors));
    reportError("timeline", new Error("boom"));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(lensErrors());
    expect(lensErrors()).toBe(lensErrors());
  });

  it("stops notifying a disposed subscriber", () => {
    let calls = 0;
    const dispose = subscribeErrors(() => calls++);
    reportError("a", new Error("one"));
    dispose();
    reportError("a", new Error("two"));

    expect(calls).toBe(1);
  });

  it("survives a subscriber that throws", () => {
    // This is the error path — it cannot itself become a source of errors.
    subscribeErrors(() => {
      throw new Error("subscriber is broken");
    });

    expect(() => reportError("timeline", new Error("boom"))).not.toThrow();
    expect(lensErrors().map((e) => e.message)).toEqual(["boom"]);
  });

  it("keeps notices in the same ring but distinguishes them from faults", () => {
    // "Recovered 900 frames" and "the oldest minute left the log" are things the
    // user must see, but filing them as errors would make the chip cry wolf.
    reportError("timeline", new Error("bad clip"));
    reportNotice("recovery", "Recovered 900 frames from the previous session.");

    expect(lensErrors().map((e) => e.level)).toEqual(["error", "notice"]);
    expect(lensErrors().filter((e) => e.level === "error")).toHaveLength(1);
  });

  it("routes uncaught errors and rejections into the same ring", () => {
    const listeners = new Map<string, (event: ErrorLikeEvent) => void>();
    const target: ErrorEventTarget = {
      addEventListener(type, cb) {
        listeners.set(type, cb);
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
    };

    const dispose = installGlobalErrorHandlers(target);
    listeners.get("error")!({ error: new Error("render threw") });
    listeners.get("unhandledrejection")!({ reason: new Error("port promise") });

    expect(lensErrors().map((e) => [e.scope, e.message])).toEqual([
      ["uncaught", "render threw"],
      ["unhandled-rejection", "port promise"],
    ]);

    dispose();
    expect(listeners.size).toBe(0);
  });
});
