import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { createCoalescer, frameScheduler } from "./coalesce.js";

/** A scheduler the test drives by hand, standing in for rAF. */
function fakeScheduler() {
  let pending: (() => void) | null = null;
  return {
    schedule: (fn: () => void) => {
      pending = fn;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
    flush: () => {
      const fn = pending;
      pending = null;
      fn?.();
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

describe("createCoalescer", () => {
  it("collapses a burst of calls into one", () => {
    // A busy app commits many times per frame. Each one re-ran every
    // derivation in the panel — the tree, the lanes, the causality sweep.
    let ran = 0;
    const s = fakeScheduler();
    const fire = createCoalescer(() => ran++, s);
    for (let i = 0; i < 50; i++) fire();
    expect(ran).toBe(0);
    s.flush();
    expect(ran).toBe(1);
  });

  it("runs again on the next frame, so updates are never dropped", () => {
    let ran = 0;
    const s = fakeScheduler();
    const fire = createCoalescer(() => ran++, s);
    fire();
    s.flush();
    fire();
    s.flush();
    expect(ran).toBe(2);
  });

  it("does nothing without a call — no idle frame loop", () => {
    let ran = 0;
    const s = fakeScheduler();
    createCoalescer(() => ran++, s);
    expect(s.scheduled).toBe(false);
    s.flush();
    expect(ran).toBe(0);
  });

  it("cancels pending work when disposed", () => {
    // Unmounting mid-burst must not fire into a dead component.
    let ran = 0;
    const s = fakeScheduler();
    const fire = createCoalescer(() => ran++, s);
    fire();
    fire.dispose();
    s.flush();
    expect(ran).toBe(0);
  });

  it("schedules once per burst, not once per call", () => {
    let scheduled = 0;
    const s = fakeScheduler();
    const counting = {
      ...s,
      schedule: (fn: () => void) => {
        scheduled++;
        return s.schedule(fn);
      },
    };
    const fire = createCoalescer(() => {}, counting);
    fire();
    fire();
    fire();
    expect(scheduled).toBe(1);
  });
});

describe("frameScheduler — hidden-tab fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still runs when rAF is paused (background / other navigator tab)", () => {
    // Without a timer fallback, coalesced UI updates stall while the tab is
    // hidden — embedded/playground looks like events were lost until focus
    // returns (and can stick if a deferred rAF never settles the handle).
    const rafCbs: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    let ran = 0;
    const fire = createCoalescer(() => ran++, frameScheduler);
    fire();
    expect(ran).toBe(0);
    expect(rafCbs).toHaveLength(1);

    vi.advanceTimersByTime(32);
    expect(ran).toBe(1);

    rafSpy.mockRestore();
  });
});
