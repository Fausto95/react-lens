/**
 * Playhead transport: one-shot play vs A/B region loop.
 */

export type PlayStep =
  | { kind: "continue"; a: number }
  | { kind: "stop"; a: number };

/**
 * Advance the playhead in axis space.
 *
 * - `loop: true` (A/B region set) — wrap at the bounds.
 * - `loop: false` — clamp and stop when leaving the session range.
 */
export function advancePlayhead(opts: {
  a: number;
  deltaA: number;
  a0: number;
  a1: number;
  loop: boolean;
}): PlayStep {
  const { a0, a1, loop } = opts;
  let pa = opts.a + opts.deltaA;
  if (loop) {
    if (pa > a1) pa = a0;
    if (pa < a0) pa = a1;
    return { kind: "continue", a: pa };
  }
  if (pa >= a1) return { kind: "stop", a: a1 };
  if (pa <= a0) return { kind: "stop", a: a0 };
  return { kind: "continue", a: pa };
}

/**
 * Where to put the playhead when starting transport.
 *
 * Keep the cursor if it still has room to travel in `dir`. If it's already at
 * the far bound (after a finished play-once, or scrubbed to the end), jump to
 * the start of the playable range so Play again isn't a no-op.
 */
export function playStartAxis(opts: {
  a: number;
  a0: number;
  a1: number;
  dir: 1 | -1;
  /** Treat "at bound" within this slack (axis units). */
  epsilon?: number;
}): number {
  const eps = opts.epsilon ?? 1e-6;
  if (opts.dir === 1 && opts.a >= opts.a1 - eps) return opts.a0;
  if (opts.dir === -1 && opts.a <= opts.a0 + eps) return opts.a1;
  // Cursor outside the A/B band — enter at the near edge for this direction.
  if (opts.a < opts.a0) return opts.a0;
  if (opts.a > opts.a1) return opts.a1;
  return opts.a;
}
