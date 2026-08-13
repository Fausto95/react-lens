import { useReducer, useEffect } from "react";
import type { TraceStore, TraceSelector } from "@reactlens/trace-engine";
import { createCoalescer } from "./coalesce.js";

/**
 * Re-render the component whenever a relevant slice of the trace store ingests.
 * Returns a monotonically increasing version so callers can key `useMemo`s on
 * it. Reads happen via the store's query methods (identity-stable), per DESIGN.
 */
export function useTraceVersion(store: TraceStore, selector: TraceSelector): number {
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  const selectorKey = "id" in selector ? String(selector.id) : "global";

  useEffect(() => {
    // One bump per frame, however many batches land in it. A busy app commits
    // many times per frame, and each notification re-ran every derivation
    // keyed on this version — the tree, the lanes, the causality sweep — so
    // the panel repeated its whole pipeline several times per paint.
    const fire = createCoalescer(bump);
    const dispose = store.subscribe(selector, fire);
    return () => {
      dispose();
      fire.dispose();
    };
    // Re-subscribe only when the target changes (selector identity is keyed below).
    // oxlint-disable-next-line react/exhaustive-deps -- selector.kind + selectorKey capture the target
  }, [store, selector.kind, selectorKey]);

  return version;
}
