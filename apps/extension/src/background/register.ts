/**
 * Registering the MAIN-world scripts, with recovery.
 *
 * `chrome.scripting.registerContentScripts` can reject with "No SW" when it
 * races the service worker's own startup — a normal MV3 condition, not a bug
 * in the call. Treating it as fatal was: one transient rejection left the hook
 * unregistered, and React Lens was then silently dead on every page until
 * Chrome happened to restart the worker.
 *
 * The retry is separated from the Chrome API so the schedule is testable
 * without a browser or real timers.
 */

/** Backoff between attempts. The worker is usually up within the first two. */
export const RETRY_DELAYS_MS = [50, 200, 800, 2000];

export type RegisterResult = { ok: true } | { ok: false; error: unknown };

export async function registerWithRetry(
  register: () => Promise<void>,
  deps: { wait?: (ms: number) => Promise<void> } = {},
): Promise<RegisterResult> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await register();
      return { ok: true };
    } catch (err) {
      lastError = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await wait(delay);
    }
  }
  return { ok: false, error: lastError };
}
