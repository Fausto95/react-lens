import { useEffect, useRef } from "react";
import {
  interactionKindLabel,
  type Interaction,
  type InteractionKind,
  type TraceStore,
} from "@reactlens/trace-engine";
import { ms, timeAxis } from "@reactlens/ui";
import { useTraceVersion } from "../useLens.js";
import { readFresh } from "../traceFresh.js";

export interface InteractionListProps {
  store: TraceStore;
  interactions: readonly Interaction[];
  /** Full session count shown in the sticky header (may exceed the windowed list). */
  totalCount: number;
  selectedId: string | null;
  t0: number;
  onSelect: (id: string) => void;
}

/** Kind pip tone for the rail — gesture / load / system. */
export function interactionKindTone(kind: InteractionKind): "gesture" | "load" | "system" {
  if (kind === "load") return "load";
  if (kind === "system") return "system";
  return "gesture";
}

/**
 * Wall span (`end - start`) is only worth showing when it clearly exceeds
 * summed React self-time. Render events often share a commit timestamp, so
 * the span can be a few ms while self-time sums to tens of ms — displaying
 * both looks like the numbers disagree.
 */
export function extraWallMs(item: Interaction): number | null {
  const extra = item.metrics.totalDuration - item.metrics.reactDuration;
  return extra >= 8 ? item.metrics.totalDuration : null;
}

export function InteractionList({
  store,
  interactions,
  totalCount,
  selectedId,
  t0,
  onSelect,
}: InteractionListProps) {
  const version = useTraceVersion(store, { kind: "global" });
  const listRef = useRef<HTMLDivElement>(null);

  // version bumps when wasted flags land after causality; interactions when the window changes.
  const wasteById = readFresh(version, () => {
    const map = new Map<string, number>();
    for (const item of interactions) {
      const wasted = store.statsInRange(item.start, item.end).wasted;
      if (wasted > 0) map.set(item.id, wasted);
    }
    return map;
  });

  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`.rl-cascade-interaction.selected`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  return (
    <div className="rl-cascade-interactions" ref={listRef}>
      <div className="rl-cascade-interactions-head">
        <span>Interactions</span>
        <span className="count">{totalCount.toLocaleString()}</span>
      </div>
      {interactions.map((item) => {
        const selected = item.id === selectedId;
        const kindLabel = interactionKindLabel(item);
        const wasted = wasteById.get(item.id) ?? 0;
        const tone = interactionKindTone(item.kind);
        const wall = extraWallMs(item);
        const started = timeAxis(Math.max(0, item.start - t0));
        return (
          <button
            type="button"
            key={item.id}
            className={`rl-cascade-interaction${selected ? " selected" : ""}`}
            data-kind={tone}
            onClick={() => onSelect(item.id)}
            title={`${item.label} · ${kindLabel} · ${ms(item.metrics.reactDuration)} React · ${item.metrics.renderCount.toLocaleString()} renders · ${started}`}
          >
            <span className={`kind-pip kind-${tone}`} aria-hidden="true" />
            <span className="title">{item.label}</span>
            <span className="trail">
              {wasted > 0 ? <span className="waste">{wasted.toLocaleString()}</span> : null}
              <span className="nren">{item.metrics.renderCount.toLocaleString()}</span>
              <span className="react">{ms(item.metrics.reactDuration)}</span>
            </span>
            {selected ? (
              <span className="foot">
                <span className="meta">{item.metrics.renderCount.toLocaleString()} renders</span>
                {wasted > 0 ? ` · ${wasted.toLocaleString()} wasted` : ""}
                {wall != null ? ` · ${ms(wall)} wall` : ""}
                {` · ${item.metrics.componentIds.length.toLocaleString()} comps · ${item.commitIds.length.toLocaleString()} ${item.commitIds.length === 1 ? "commit" : "commits"}`}
                {item.metrics.stateUpdates > 1
                  ? ` · ${item.metrics.stateUpdates.toLocaleString()} state`
                  : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
