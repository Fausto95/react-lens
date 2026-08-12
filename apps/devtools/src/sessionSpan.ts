import type { TraceStore } from "@reactlens/trace-engine";

/**
 * Wall-clock span of captured work (first activity → last activity+duration).
 *
 * Commit timestamps alone are wrong here: every render in a commit shares one
 * `timestamp`, so a single mount commit reported `0.0 s` while the timeline
 * already showed clips via render durations.
 */
export function sessionSpanMs(store: TraceStore): number {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;

  for (const instance of store.allInstances()) {
    for (const render of store.rendersOf(instance.id)) {
      lo = Math.min(lo, render.timestamp);
      hi = Math.max(
        hi,
        render.timestamp + Math.max(render.totalDuration, render.selfDuration, 0),
      );
    }
  }
  for (const commit of store.commits()) {
    lo = Math.min(lo, commit.timestamp);
    hi = Math.max(hi, commit.endTimestamp);
  }
  for (const event of store.allEvents()) {
    if (event.type === "interaction" || event.type === "effect") {
      lo = Math.min(lo, event.timestamp);
      hi = Math.max(hi, event.timestamp);
    }
  }

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  return Math.max(0, hi - lo);
}
