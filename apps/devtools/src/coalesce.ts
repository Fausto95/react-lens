/**
 * Collapse a burst of calls into one, on the next frame.
 *
 * The trace store notifies once per ingest, and a busy app commits many times
 * per frame. Every notification re-ran the panel's whole derivation chain —
 * the component tree, the lanes, the causality sweep — so the panel did the
 * same work several times over before the browser painted once.
 *
 * The store stays a faithful log (it must notify for every batch); the
 * coalescing belongs here, at the UI's subscription, where "once per painted
 * frame" is the honest resolution.
 */

export interface Scheduler {
  schedule: (fn: () => void) => number;
  cancel: (handle: number) => void;
}

/**
 * rAF, with a timer fallback: rAF never fires in a hidden tab, and the panel
 * still has to notice that the trace moved on.
 */
export const frameScheduler: Scheduler = {
  schedule: (fn) => {
    if (typeof requestAnimationFrame === "function") {
      const raf = requestAnimationFrame(fn);
      return raf;
    }
    return setTimeout(fn, 16) as unknown as number;
  },
  cancel: (handle) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else clearTimeout(handle);
  },
};

export interface Coalescer {
  (): void;
  dispose: () => void;
}

/** Wraps `run` so any number of calls before the next frame produce one run. */
export function createCoalescer(run: () => void, scheduler: Scheduler = frameScheduler): Coalescer {
  let handle: number | null = null;

  const fire = (() => {
    if (handle !== null) return;
    handle = scheduler.schedule(() => {
      handle = null;
      run();
    });
  }) as Coalescer;

  fire.dispose = () => {
    if (handle === null) return;
    scheduler.cancel(handle);
    handle = null;
  };

  return fire;
}
