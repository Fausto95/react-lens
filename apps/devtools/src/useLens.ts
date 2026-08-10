import { useSyncExternalStore, useRef, useCallback } from "react";
import type { TraceStore, TraceSelector } from "@react-lens/trace-engine";

/**
 * Subscribe a component to a narrow slice of the trace store. Returns a version
 * number that bumps on relevant ingests — read the actual data via the store's
 * query methods so identity stays stable (DESIGN §9).
 */
export function useTraceVersion(store: TraceStore, selector: TraceSelector): number {
  const versionRef = useRef(0);
  const selectorKey = "id" in selector ? String(selector.id) : "global";

  const subscribe = useCallback(
    (onChange: () => void) =>
      store.subscribe(selector, () => {
        versionRef.current++;
        onChange();
      }),
    // Re-subscribe only when the target changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, selector.kind, selectorKey],
  );

  return useSyncExternalStore(
    subscribe,
    () => versionRef.current,
    () => 0,
  );
}
