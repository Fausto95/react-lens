/**
 * Liveness watchdog for a `chrome.runtime.Port`.
 *
 * Ports fail in two ways. `onDisconnect` covers the loud one. The quiet one —
 * the MV3 worker recycled, the peer's context torn down, a port that survives
 * its owner — leaves both sides believing they are connected while nothing
 * crosses. That is indistinguishable from an idle app, so it can go unnoticed
 * for the whole session: exactly the failure that loses traces.
 *
 * A ping the peer must answer turns that silence into a disconnect we can act
 * on. `proven()` is the other half: the reconnect backoff should only reset
 * once a peer has actually answered, or a port that dies on arrival resets it
 * on every attempt and the retry loop never backs off.
 */

/** How often to ping. Comfortably under the MV3 worker's 30s idle timeout. */
export const HEARTBEAT_INTERVAL_MS = 5_000;
/** How long to wait for the answer before calling the port dead. */
export const HEARTBEAT_TIMEOUT_MS = 5_000;

export interface Heartbeat {
  /** Feed in the peer's answer; unmatched ids are ignored. */
  pong(id: number): void;
  /** True once the peer has answered at least one ping on this port. */
  proven(): boolean;
  stop(): void;
}

export function createHeartbeat(opts: {
  send: (id: number) => void;
  onDead: () => void;
  intervalMs?: number;
  timeoutMs?: number;
}): Heartbeat {
  const intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  let nextId = 1;
  let waitingFor: number | null = null;
  let proven = false;
  let dead = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const beat = () => {
    if (dead) return;
    const id = nextId++;
    waitingFor = id;
    opts.send(id);
    timer = setTimeout(() => {
      if (dead || waitingFor !== id) return;
      // One report only: the caller tears the port down, and a second call
      // would fight whatever recovery it started.
      dead = true;
      opts.onDead();
    }, timeoutMs);
  };

  const schedule = () => {
    timer = setTimeout(() => {
      beat();
    }, intervalMs);
  };
  schedule();

  return {
    pong(id) {
      if (dead || waitingFor !== id) return;
      waitingFor = null;
      proven = true;
      if (timer !== null) clearTimeout(timer);
      schedule();
    },
    proven() {
      return proven;
    },
    stop() {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
