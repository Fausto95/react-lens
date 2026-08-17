import type { TimeTravelStoreAdapter } from "@reactlens/protocol";
import { createStoreAdapter } from "./register.js";

/**
 * The part of a Zustand vanilla store this adapter needs. Structural on
 * purpose: no dependency and no peer dependency on zustand, so any 4.x/5.x
 * store — or anything shaped like one — works.
 */
export interface ZustandLikeStore<T> {
  getState(): T;
  setState(next: T, replace: true): void;
}

/**
 * Rewind a Zustand store with the playhead.
 *
 * Restores with `replace: true` rather than a merge: a merge would leave keys
 * the app never had at that point in time, which is precisely what time travel
 * must not do. Actions live in the state object, so the snapshot carries them
 * and they stay callable after a restore. `setState` notifies subscribers, so
 * every `useStore` component re-renders.
 */
export function zustandAdapter<T>(
  store: ZustandLikeStore<T>,
  options: { id?: string } = {},
): TimeTravelStoreAdapter {
  return createStoreAdapter<T>({
    id: options.id ?? "zustand",
    get: () => store.getState(),
    set: (snapshot) => store.setState(snapshot, true),
  });
}
