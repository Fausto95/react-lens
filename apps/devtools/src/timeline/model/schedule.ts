import type { CommitId } from "@reactlens/protocol";
import type { CommitSummary } from "@reactlens/trace-engine";
import type { TimeSpan } from "./scale.js";
import type { Bounds } from "./viewport.js";

/**
 * Replay as an ordered list of stops, not a continuous sweep.
 *
 * Time travel rebuilds the page's state for a cursor timestamp, and that state
 * only changes at a commit. Sweeping smoothly emitted a fresh timestamp every
 * frame — hundreds of synchronous React flushes that made replay crawl — while
 * naively snapping the cursor to commit boundaries suppressed every
 * intermediate value and froze the playhead instead.
 *
 * Both failures come from mixing two jobs. A schedule separates them: the
 * stops are *what the page must show*, and the ticker independently decides
 * *when*. That makes "replay walks every state and returns live" a property of
 * a pure function.
 */
export interface ReplayStop {
  /** Cursor timestamp to emit. */
  t: number;
  /** The commit this stop shows the result of; null for the closing stop. */
  commitId: CommitId | null;
  /** The final stop returns the panel (and page) to the present. */
  live: boolean;
}

/**
 * Stops for replaying `region` (or the whole session when null): one per commit
 * that overlaps it, ordered, each landing *after* the commit so the page shows
 * its result — then a final live stop.
 */
export function replaySchedule(
  commits: readonly CommitSummary[],
  region: TimeSpan | null,
  bounds: Bounds,
): ReplayStop[] {
  const lo = region ? Math.min(region.start, region.end) : bounds.t0;
  const hi = region ? Math.max(region.start, region.end) : bounds.t1;

  const stops: ReplayStop[] = [];
  const seen = new Set<CommitId>();
  // Commits arrive in ingest order, which is usually but not guaranteed
  // chronological; sort so the replay can never step backwards.
  const ordered = [...commits].sort((a, b) => a.endTimestamp - b.endTimestamp);

  for (const commit of ordered) {
    // Overlap, not containment: a commit straddling the region's edge is part
    // of what happened inside it.
    if (commit.endTimestamp < lo || commit.timestamp > hi) continue;
    if (seen.has(commit.commitId)) continue;
    seen.add(commit.commitId);
    stops.push({ t: commit.endTimestamp, commitId: commit.commitId, live: false });
  }

  stops.push({ t: hi, commitId: null, live: true });
  return stops;
}

/** Which stop a 0→1 progress value lands on. Monotonic and clamped. */
export function stopIndexAt(stops: readonly ReplayStop[], progress: number): number {
  if (stops.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, progress));
  return Math.min(stops.length - 1, Math.floor(clamped * stops.length));
}
