import type { CommitId } from "@reactlens/protocol";
import type { CommitSummary } from "@reactlens/trace-engine";
import type { TimeSpan } from "./scale.js";
import type { Bounds } from "./viewport.js";

/**
 * Replay, as a sweep that is not allowed to skip anything.
 *
 * Time travel rebuilds the page's state for a cursor timestamp, and that state
 * only changes at a commit — so the commits are the stops the replay owes the
 * viewer. Emitting *only* those made playback a series of jumps; emitting a
 * free timestamp every frame stepped over short commits, and the page never
 * showed those states at all.
 *
 * Separating the two jobs fixes both. The stops are *what must be shown*; the
 * sweep decides *where the playhead would otherwise be*; `advanceReplay`
 * reconciles them. All of it is pure, so "replay visits every state, moves
 * smoothly, and returns live" is a property under test rather than something
 * to observe by eye.
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
 * Where the playhead would be at a given 0→1 of the way through a replay,
 * before any stop is taken into account.
 *
 * This is a seam, not decoration. Replaying uniformly in *wall-clock* time
 * looks broken on a compressed scale: a session with one long idle gap draws
 * that gap as a 34 px gutter, so the playhead would spend most of the replay
 * apparently frozen inside it. The timeline supplies a sweep that is uniform
 * in *screen* space instead, and the schedule stays independent of geometry.
 */
export type Sweep = (progress: number) => number;

/** Uniform in time — the plain reading, and the default when there is no scale. */
export function linearSweep(span: { lo: number; hi: number }): Sweep {
  return (p) => span.lo + (span.hi - span.lo) * Math.max(0, Math.min(1, p));
}

/**
 * Close enough to the end that starting there would be a zero-length replay.
 * At that point ▶ means "play it again", not "play the last millisecond".
 */
const RESTART_EPSILON_MS = 1;

/**
 * The time range a replay covers: the region if set, else the whole session —
 * picked up from `from` when the playhead is parked inside it.
 *
 * ▶ is labelled *play from playhead* and never was: every replay restarted at
 * the beginning, so positioning the ruler before pressing it did nothing.
 */
export function replaySpan(
  region: TimeSpan | null,
  bounds: Bounds,
  from?: number | null,
): { lo: number; hi: number } {
  const lo = region ? Math.min(region.start, region.end) : bounds.t0;
  const hi = region ? Math.max(region.start, region.end) : bounds.t1;
  if (from == null || from <= lo || from >= hi - RESTART_EPSILON_MS) return { lo, hi };
  return { lo: from, hi };
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
  from?: number | null,
): ReplayStop[] {
  const { lo, hi } = replaySpan(region, bounds, from);

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

/**
 * Where ⏮ / ⏭ put the playhead: the adjacent commit, since that is where the
 * page's state actually changes — stepping by a fixed slice of time would land
 * between commits and show the same thing twice.
 *
 * Going back past the first commit rewinds to the top rather than sticking,
 * which is what a rewind control is for.
 */
export function stepStop(
  stops: readonly ReplayStop[],
  span: { lo: number; hi: number },
  t: number,
  dir: 1 | -1,
): number {
  const times = stops.map((s) => s.t);
  if (dir === 1) {
    const next = times.filter((v) => v > t + RESTART_EPSILON_MS).sort((a, b) => a - b)[0];
    return next ?? span.hi;
  }
  const prev = times.filter((v) => v < t - RESTART_EPSILON_MS).sort((a, b) => b - a)[0];
  // Nothing behind the first commit but the span's own start — which is where
  // ⏮ should land, rather than sticking on that commit.
  return prev ?? span.lo;
}

/**
 * One frame of replay: where the cursor goes, given progress and how many
 * stops have already been shown.
 *
 * Playback has two obligations that pull against each other. It must *look*
 * like playback — the playhead sweeping through time, not hopping — and it
 * must not step over a commit, or the page silently skips a state. Sweeping
 * freely does the first and fails the second (a 5 ms commit falls between two
 * frames); walking stop to stop does the second and fails the first, which is
 * the jump-from-start-to-end this replaces.
 *
 * So: sweep freely, but never past the next stop. Between commits the cursor
 * moves with the clock; when it reaches one it lands there for a frame and
 * releases. Dense stretches degrade to stepping, which is the honest reading.
 */
export function advanceReplay(
  stops: readonly ReplayStop[],
  sweep: Sweep,
  progress: number,
  visited: number,
): { t: number; live: boolean; visited: number } {
  const p = Math.max(0, Math.min(1, progress));
  const swept = sweep(p);
  const next = stops[visited];
  if (next && swept >= next.t) return { t: next.t, live: next.live, visited: visited + 1 };
  // Hold behind the stop we have not shown yet, so it is never overshot.
  return { t: next ? Math.min(swept, next.t) : swept, live: false, visited };
}
