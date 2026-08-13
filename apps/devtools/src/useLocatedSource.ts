import { useEffect, useState } from "react";
import type { ComponentId, SourceLocation } from "@reactlens/protocol";
import { locateComponentSource, type LocatedSource } from "./sourceLocator.js";

/**
 * Production-build source for a component, fetched lazily.
 *
 * A no-op when React already handed us a location (`existing`): dev builds
 * carry `_debugStack`, and locating costs a shallow component call.
 */
export function useLocatedSource(
  componentId: ComponentId,
  existing: SourceLocation | undefined,
): LocatedSource | null {
  const [located, setLocated] = useState<LocatedSource | null>(null);
  const [seenId, setSeenId] = useState(componentId);
  if (seenId !== componentId) {
    setSeenId(componentId);
    setLocated(null);
  }

  useEffect(() => {
    if (existing) return;
    let alive = true;
    void locateComponentSource(componentId).then((result) => {
      if (alive) setLocated(result);
    });
    return () => {
      alive = false;
    };
  }, [componentId, existing]);

  return existing ? null : located;
}
