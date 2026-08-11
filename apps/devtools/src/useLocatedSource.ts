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

  useEffect(() => {
    if (existing) {
      setLocated(null);
      return;
    }
    let alive = true;
    setLocated(null);
    void locateComponentSource(componentId).then((result) => {
      if (alive) setLocated(result);
    });
    return () => {
      alive = false;
    };
  }, [componentId, existing]);

  return existing ? null : located;
}
