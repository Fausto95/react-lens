import { clamp } from "./geometry.js";

/**
 * Replay pacing: frame-delta accumulation over a fixed duration. A stalled
 * frame (hidden tab, heavy travel apply) contributes at most this much, so
 * stalls pause playback instead of skipping a stretch of the session.
 */
export const FRAME_DELTA_CAP_MS = 100;
/** rAF is paused in hidden tabs — a timer keeps the replay advancing. */
export const FALLBACK_INTERVAL_MS = 100;

export interface ReplayTicker {
  stop(): void;
}

/**
 * Drives replay progress from 0 to 1 over `durMs` of accumulated frame time.
 * Each frame is scheduled through BOTH requestAnimationFrame and a timeout —
 * whichever fires first wins and disarms the other (the same convention as
 * the time-travel controller's flush). Visible tabs get smooth rAF pacing;
 * hidden/backgrounded documents still make progress on throttled timers.
 */
export function startReplayTicker(
  durMs: number,
  loop: boolean,
  onTick: (frac: number, done: boolean) => void,
  now: () => number = () => performance.now(),
): ReplayTicker {
  let elapsed = 0;
  let lastWall = now();
  let raf = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const unschedule = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tick = (): void => {
    unschedule();
    if (stopped) return;
    const nowWall = now();
    elapsed += Math.min(nowWall - lastWall, FRAME_DELTA_CAP_MS);
    lastWall = nowWall;
    let frac = clamp(elapsed / durMs, 0, 1);
    if (frac >= 1 && loop) {
      elapsed = 0;
      frac = 0;
    }
    const done = frac >= 1 && !loop;
    onTick(frac, done);
    if (!done) schedule();
  };

  const schedule = (): void => {
    raf = requestAnimationFrame(tick);
    timer = setTimeout(tick, FALLBACK_INTERVAL_MS);
  };

  schedule();
  return {
    stop() {
      stopped = true;
      unschedule();
    },
  };
}
