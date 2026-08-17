import type { TimeTravelStoreAdapter } from "./time-travel.js";

/** Where the page-facing API lives. Apps reach it through `@reactlens/adapters`. */
export const REACT_LENS_GLOBAL = "__REACT_LENS__";

/**
 * The surface an inspected page may call. Installed by whichever host is
 * capturing — the extension's MAIN-world bridge or the embedded runtime — and
 * absent when React Lens is not running, so every call site must be optional.
 */
export interface ReactLensPageApi {
  /** Name the interaction the next commits belong to. */
  markInteraction(name: string, untilMs?: number): void;
  /** Opt in a store to time travel; returns an unregister function. */
  registerStore(adapter: TimeTravelStoreAdapter): () => void;
  /**
   * Adapters registered before a host installed. Present on the stub the page
   * shim leaves behind, and drained (then dropped) by the host.
   */
  pending?: PendingStoreRegistration[];
}

/**
 * A registration made against the stub. The two sides communicate through this
 * record instead of a disposer they cannot exchange: the host writes `dispose`
 * when it drains, the page writes `cancelled` if it unregisters first.
 */
export interface PendingStoreRegistration {
  adapter: TimeTravelStoreAdapter;
  /** Set by the host once the adapter is really registered. */
  dispose?: () => void;
  /** Set by the page when it unregisters before the host drained the queue. */
  cancelled?: boolean;
}

type GlobalWithApi = { [REACT_LENS_GLOBAL]?: ReactLensPageApi };

/**
 * Install the real API, adopting anything registered against a stub. Hosts must
 * call this as early as possible (module scope, before the app evaluates) —
 * the queue exists for the cases where that still isn't early enough.
 */
export function installPageApi(target: unknown, api: ReactLensPageApi): void {
  if (typeof target !== "object" || target === null) return;
  const host = target as GlobalWithApi;
  const pending = host[REACT_LENS_GLOBAL]?.pending;
  host[REACT_LENS_GLOBAL] = api;
  if (!pending) return;
  for (const entry of pending) {
    if (entry.cancelled) continue;
    entry.dispose = api.registerStore(entry.adapter);
  }
}

/**
 * The API to call from page code: the host's if one is installed, otherwise a
 * queueing stub so registrations made before the host installs are not lost.
 * Returns null when there is no global object to attach to (SSR).
 */
export function resolvePageApi(target: unknown): ReactLensPageApi | null {
  if (typeof target !== "object" || target === null) return null;
  const host = target as GlobalWithApi;
  const existing = host[REACT_LENS_GLOBAL];
  if (existing) return existing;
  const pending: PendingStoreRegistration[] = [];
  const stub: ReactLensPageApi = {
    // A stub interaction mark has nothing to record against; drop it rather
    // than queue it, since its window has passed by the time a host arrives.
    markInteraction: () => {},
    registerStore(adapter) {
      const entry: PendingStoreRegistration = { adapter };
      pending.push(entry);
      return () => {
        if (entry.dispose) entry.dispose();
        else entry.cancelled = true;
      };
    },
    pending,
  };
  host[REACT_LENS_GLOBAL] = stub;
  return stub;
}
