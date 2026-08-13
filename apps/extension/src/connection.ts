/**
 * Classifying transport failures the panel cannot retry its way out of.
 *
 * When the extension is reloaded or updated, every existing panel's context is
 * torn down. `chrome.runtime.connect` then throws synchronously — the panel's
 * reconnect loop turned that into an uncaught error every 500ms forever, which
 * is both noisy and pointless: an invalidated context never comes back. The
 * page must be reopened.
 *
 * Everything else (the worker asleep, a port dropped mid-navigation) is
 * genuinely transient and worth retrying.
 */

/** Reconnect backoff for transient failures; the last delay repeats. */
export const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];

/** Extra fraction of the base delay added as random jitter (0..jitter). */
export const RECONNECT_JITTER_FRACTION = 0.25;

export function isContextInvalidated(error: unknown): boolean {
  // Chrome hands this back three ways: a thrown Error, `runtime.lastError`
  // (a plain `{ message }`), and occasionally a bare string. Stringifying the
  // object form yields "[object Object]" and silently never matches.
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown })?.message === "string"
          ? (error as { message: string }).message
          : "";
  return /extension context invalidated|context invalidated|receiving end does not exist/i.test(
    message,
  );
}

/**
 * Delay before attempt `n` (0-based), holding at the longest, plus jitter so
 * a tab full of content scripts does not reconnect in lockstep after the SW
 * wakes.
 */
export function reconnectDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  const base = RECONNECT_DELAYS_MS[index]!;
  const jitter = Math.floor(Math.random() * base * RECONNECT_JITTER_FRACTION);
  return base + jitter;
}
