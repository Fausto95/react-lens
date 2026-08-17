import type { TimeTravelStoreAdapter } from "@reactlens/protocol";
import { createStoreAdapter } from "./register.js";

/** The part of a TanStack QueryClient this adapter needs. */
export interface QueryClientLike {
  clear(): void;
}

/**
 * `dehydrate`/`hydrate` come from the app's own @tanstack/react-query import
 * rather than a peer dependency here: React Lens then works with whatever
 * version the app pins, and cannot pull a second copy of the library into the
 * bundle.
 */
export interface QueryAdapterOptions<C extends QueryClientLike> {
  queryClient: C;
  dehydrate: (client: C) => unknown;
  hydrate: (client: C, snapshot: unknown) => void;
  id?: string;
  /**
   * How a snapshot is put back.
   *
   * - "replace" (default): clear the cache, then hydrate. This is the only mode
   *   that actually rewinds — `hydrate` keeps whichever copy is newer, so a
   *   query the app updated after the snapshot would otherwise stay at its live
   *   value. Observers on cleared keys refetch.
   * - "merge": hydrate over the live cache. Non-destructive, but only fills in
   *   queries the cache has since lost; it cannot move an existing query back.
   */
  mode?: "replace" | "merge";
}

/**
 * Rewind a TanStack Query cache with the playhead.
 *
 * Only what `dehydrate` includes is restored — by default successful queries,
 * not mutations or errored/pending ones. Pass a wrapped `dehydrate` if the app
 * needs different rules.
 */
export function queryAdapter<C extends QueryClientLike>(
  options: QueryAdapterOptions<C>,
): TimeTravelStoreAdapter {
  const { queryClient, dehydrate, hydrate } = options;
  return createStoreAdapter<unknown>({
    id: options.id ?? "query",
    get: () => dehydrate(queryClient),
    set: (snapshot) => {
      if (options.mode !== "merge") queryClient.clear();
      hydrate(queryClient, snapshot);
    },
  });
}
