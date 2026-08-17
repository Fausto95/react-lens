import { resolvePageApi } from "@reactlens/protocol";
import type { TimeTravelStoreAdapter } from "@reactlens/protocol";

/**
 * Build an adapter from a plain get/set pair. Every shipped adapter is a thin
 * wrapper over this, and it is the seam for anything not covered by one —
 * Jotai, a module singleton, an observable.
 */
export function createStoreAdapter<T>(spec: {
  id: string;
  get: () => T;
  set: (snapshot: T) => void;
}): TimeTravelStoreAdapter {
  return {
    id: spec.id,
    getSnapshot: () => spec.get(),
    applySnapshot: (snapshot) => spec.set(snapshot as T),
  };
}

/**
 * Opt a store into time travel. Safe to call unconditionally: with no React
 * Lens running it registers against a stub that no host will ever drain, so it
 * costs one array entry and never throws.
 *
 * Returns an unregister function — pass it straight to an effect cleanup or a
 * hot-reload dispose handler.
 */
export function registerStore(adapter: TimeTravelStoreAdapter): () => void {
  const api = resolvePageApi(globalThis);
  if (!api) return () => {};
  return api.registerStore(adapter);
}

/** Register several adapters, unregistering all of them through one disposer. */
export function registerStores(...adapters: TimeTravelStoreAdapter[]): () => void {
  const disposers = adapters.map(registerStore);
  return () => {
    for (const off of disposers) off();
  };
}
