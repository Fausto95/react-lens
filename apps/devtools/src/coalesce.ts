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
 * rAF for visible tabs, plus a short timer so a hidden/backgrounded tab still
 * notices that the trace moved on. Whichever fires first wins; the other is
 * cancelled. (rAF alone is paused while the document is hidden.)
 */
export const frameScheduler: Scheduler = (() => {
  let seq = 1;
  const pending = new Map<
    number,
    { raf: number | null; timer: ReturnType<typeof setTimeout> | null }
  >();

  const clear = (id: number) => {
    const p = pending.get(id);
    if (!p) return;
    if (p.raf != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(p.raf);
    }
    if (p.timer != null) clearTimeout(p.timer);
    pending.delete(id);
  };

  return {
    schedule: (fn) => {
      const id = seq++;
      let done = false;
      const run = () => {
        if (done) return;
        done = true;
        clear(id);
        fn();
      };
      const raf =
        typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : null;
      const timer = setTimeout(run, 32);
      pending.set(id, { raf, timer });
      return id;
    },
    cancel: (handle) => {
      clear(handle);
    },
  };
})();

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
