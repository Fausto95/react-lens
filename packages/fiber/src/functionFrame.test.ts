import { describe, it, expect, vi } from "vite-plus/test";
import { describeFunctionFrame, parseFrameLocation, clearFrameCache } from "./functionFrame.js";

/**
 * The compiled definition site of a component function, without any dev-only
 * fiber fields — the only way to attribute source in a production build.
 */
describe("describeFunctionFrame", () => {
  it("finds the definition frame of a plain function component", () => {
    function Card() {
      return null;
    }
    const frame = describeFunctionFrame(Card, {});
    expect(frame).toBeTruthy();
    // The frame must point at THIS test file, where Card is defined.
    expect(frame!).toMatch(/functionFrame\.test\.ts/);
    const loc = parseFrameLocation(frame!);
    expect(loc).not.toBeNull();
    expect(loc!.file).toMatch(/functionFrame\.test\.ts$/);
    expect(loc!.line).toBeGreaterThan(0);
  });

  it("finds the definition frame of a class component via construct", () => {
    class Widget {
      props: unknown;
      render() {
        return null;
      }
    }
    const frame = describeFunctionFrame(Widget, { construct: true });
    expect(frame).toBeTruthy();
    expect(parseFrameLocation(frame!)!.file).toMatch(/functionFrame\.test\.ts$/);
  });

  it("caches per function — a second call does not re-invoke the component", () => {
    const body = vi.fn(() => null);
    function Cached() {
      return body();
    }
    clearFrameCache();
    const first = describeFunctionFrame(Cached, {});
    const callsAfterFirst = body.mock.calls.length;
    const second = describeFunctionFrame(Cached, {});
    expect(second).toBe(first);
    expect(body.mock.calls.length).toBe(callsAfterFirst);
  });

  it("restores the dispatcher and Error.prepareStackTrace afterwards", () => {
    const ref = { H: { useState: () => {} } as unknown };
    const before = ref.H;
    const prepare = Error.prepareStackTrace;
    describeFunctionFrame(function Probe() {
      return null;
    }, { currentDispatcherRef: ref });
    expect(ref.H).toBe(before);
    expect(Error.prepareStackTrace).toBe(prepare);
  });

  it("nulls the dispatcher DURING capture so hooks throw instead of mutating state", () => {
    const ref = { H: { useState: () => {} } as unknown };
    let sawDispatcher: unknown = "unset";
    function UsesHooks() {
      sawDispatcher = ref.H;
      // A real hook call would blow up on a null dispatcher — that throw is
      // exactly what produces the sample stack.
      throw new Error("hook");
    }
    describeFunctionFrame(UsesHooks, { currentDispatcherRef: ref });
    expect(sawDispatcher).toBeNull();
  });

  it("silences console output produced during the shallow call", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    describeFunctionFrame(function Noisy() {
      console.error("should not surface");
      throw new Error("boom");
    }, {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns null for non-functions and re-entrant calls", () => {
    expect(describeFunctionFrame(null as unknown as () => void, {})).toBeNull();
    // Re-entrancy: a component whose body asks for another frame gets nothing,
    // so a hostile component cannot recurse us into a stack overflow.
    let inner: string | null = "unset";
    function Reentrant() {
      inner = describeFunctionFrame(function Other() {
        return null;
      }, {});
      throw new Error("outer");
    }
    describeFunctionFrame(Reentrant, {});
    expect(inner).toBeNull();
  });

  it("swallows a rejected promise from an async component", async () => {
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    describeFunctionFrame(async function AsyncCard() {
      throw new Error("async boom");
    }, {});
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onUnhandled);
    expect(onUnhandled).not.toHaveBeenCalled();
  });
});

describe("parseFrameLocation", () => {
  it("parses V8 frames with a function name and parenthesized location", () => {
    expect(parseFrameLocation("    at Card (https://app.dev/assets/index-abc.js:1:23456)")).toEqual({
      file: "https://app.dev/assets/index-abc.js",
      line: 1,
      column: 23456,
    });
  });

  it("parses bare-location V8 frames and absolute paths", () => {
    expect(parseFrameLocation("    at /repo/src/App.tsx:12:5")).toEqual({
      file: "/repo/src/App.tsx",
      line: 12,
      column: 5,
    });
  });

  it("parses Firefox/Safari frames (name@url:line:col)", () => {
    expect(parseFrameLocation("Card@https://app.dev/assets/index-abc.js:3:100")).toEqual({
      file: "https://app.dev/assets/index-abc.js",
      line: 3,
      column: 100,
    });
  });

  it("strips query strings from chunk URLs", () => {
    expect(parseFrameLocation("    at Card (https://app.dev/index.js?v=abc:1:2)")!.file).toBe(
      "https://app.dev/index.js",
    );
  });

  it("returns null for frames without a location", () => {
    expect(parseFrameLocation("    at <anonymous>")).toBeNull();
    expect(parseFrameLocation("")).toBeNull();
  });
});
