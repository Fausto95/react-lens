import { useEffect, useMemo, useRef, type CSSProperties } from "react";
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

  const maxReact = useMemo(() => {
    let max = 0;
    for (const item of interactions) {
      if (item.metrics.reactDuration > max) max = item.metrics.reactDuration;
    }
    return max;
  }, [interactions]);

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
        <span>{totalCount.toLocaleString()}</span>
      </div>
      {interactions.map((item) => {
        const selected = item.id === selectedId;
        const kindLabel = interactionKindLabel(item);
        const wasted = wasteById.get(item.id) ?? 0;
        const heat = maxReact > 0 ? Math.round((item.metrics.reactDuration / maxReact) * 100) : 0;
        const tone = interactionKindTone(item.kind);
        return (
          <button
            type="button"
            key={item.id}
            className={`rl-cascade-interaction${selected ? " selected" : ""}`}
            data-kind={tone}
            onClick={() => onSelect(item.id)}
            title={`${item.label} · ${kindLabel}`}
          >
            <span className={`kind-pip kind-${tone}`} aria-hidden="true" />
            <span className="title">{item.label}</span>
            <span className="react">{ms(item.metrics.reactDuration)}</span>
            <span className="heat-row">
              <span className="hbar" style={{ "--w": `${heat}%` } as CSSProperties}>
                <i />
              </span>
              <span className="meta">{item.metrics.renderCount.toLocaleString()} renders</span>
              {wasted > 0 ? <span className="waste">{wasted}</span> : null}
              <span className="time">{timeAxis(Math.max(0, item.start - t0))}</span>
            </span>
            {selected ? (
              <span className="stats">
                <span>
                  {kindLabel} · {ms(item.metrics.totalDuration)} wall
                </span>
                <span>
                  {item.metrics.componentIds.length.toLocaleString()} components ·{" "}
                  {item.commitIds.length.toLocaleString()} commits
                </span>
                <span>
                  {item.metrics.stateUpdates.toLocaleString()} state
                  {wasted > 0 ? ` · ${wasted.toLocaleString()} wasted` : ""}
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
