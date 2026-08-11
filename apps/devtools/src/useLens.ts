import { useReducer, useEffect } from "react";
import type { TraceStore, TraceSelector } from "@reactlens/trace-engine";

/**
 * Re-render the component whenever a relevant slice of the trace store ingests.
 * Returns a monotonically increasing version so callers can key `useMemo`s on
 * it. Reads happen via the store's query methods (identity-stable), per DESIGN.
 */
export function useTraceVersion(store: TraceStore, selector: TraceSelector): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  const selectorKey = "id" in selector ? String(selector.id) : "global";

  useEffect(() => {
    const dispose = store.subscribe(selector, bump);
    return dispose;
    // Re-subscribe only when the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, selector.kind, selectorKey]);

  return version;
}
