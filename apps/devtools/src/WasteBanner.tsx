import { useEffect, useRef, useState } from "react";
import type { TraceStore, Interaction } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId } from "@reactlens/protocol";
import { useTraceVersion } from "./useLens.js";
import { IconClose } from "@reactlens/icons";

const WASTE_THRESHOLD = 5;
const QUIET_MS = 450;

/**
 * After an interaction settles, if enough renders produced no observable DOM
 * change, surface a dismissible severe chip — not a card.
 */
export function WasteBanner({
  store,
  causality,
  onInspect,
}: {
  store: TraceStore;
  causality: Causality;
  onInspect: (info: { interactionId: string; worstId: ComponentId | null }) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [banner, setBanner] = useState<{
    interactionId: string;
    label: string;
    wasted: number;
    total: number;
    worstId: ComponentId | null;
  } | null>(null);
  const dismissed = useRef(new Set<string>());
  const processedEnd = useRef(new Map<string, number>());

  useEffect(() => {
    const interactions = store.interactions();
    const latest = [...interactions].reverse().find((i) => i.kind !== "load" && i.kind !== "system");
    if (!latest) return;
    if (processedEnd.current.get(latest.id) === latest.end) return;

    const timer = window.setTimeout(() => {
      const fresh = store.interactions().find((i) => i.id === latest.id) ?? latest;
      processedEnd.current.set(fresh.id, fresh.end);
      if (dismissed.current.has(fresh.id)) return;

      const { wasted, total, worstId } = wasteOf(fresh, store, causality);
      if (wasted < WASTE_THRESHOLD) return;
      setBanner({
        interactionId: fresh.id,
        label: fresh.label,
        wasted,
        total,
        worstId,
      });
    }, QUIET_MS);

    return () => clearTimeout(timer);
  }, [store, causality, version]);

  if (!banner) return null;

  return (
    <div className="rl-waste-chip" role="status">
      <button
        type="button"
        className="rl-waste-chip-body"
        onClick={() => {
          onInspect({ interactionId: banner.interactionId, worstId: banner.worstId });
          dismissed.current.add(banner.interactionId);
          setBanner(null);
        }}
      >
        <span className="rl-waste-chip-pip" />
        <span className="rl-waste-chip-label">
          {banner.label} · {banner.wasted}/{banner.total} wasted
        </span>
        <span className="rl-waste-chip-cta">Inspect</span>
      </button>
      <button
        className="rl-icon-btn"
        title="Dismiss"
        aria-label="Dismiss waste notice"
        onClick={() => {
          dismissed.current.add(banner.interactionId);
          setBanner(null);
        }}
      >
        <IconClose size={12} />
      </button>
    </div>
  );
}

function wasteOf(
  interaction: Interaction,
  store: TraceStore,
  causality: Causality,
): { wasted: number; total: number; worstId: ComponentId | null } {
  let wasted = 0;
  const counts = new Map<ComponentId, number>();
  let checked = 0;
  for (const renderId of interaction.renderIds) {
    if (checked++ >= 80) break;
    try {
      if (causality.why(renderId).verdict !== "no-observable-change") continue;
      wasted++;
      const cid = store.getRender(renderId)?.componentId;
      if (cid !== undefined) counts.set(cid, (counts.get(cid) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  }
  let worstId: ComponentId | null = null;
  let best = 0;
  for (const [id, n] of counts) {
    if (n > best) {
      best = n;
      worstId = id;
    }
  }
  return { wasted, total: interaction.renderIds.length, worstId };
}
