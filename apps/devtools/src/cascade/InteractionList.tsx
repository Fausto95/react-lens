import { useEffect, useRef, useState } from "react";
import type { Interaction, TraceStore } from "@reactlens/trace-engine";
import { ms } from "@reactlens/ui";
import { useTraceVersion } from "../useLens.js";
import { readFresh } from "../traceFresh.js";
import {
  DEFAULT_RAIL_SORT,
  RAIL_SORTS,
  buildRailRows,
  interactionKindTone,
  type RailSortKey,
} from "./interactionRail.js";

export interface InteractionListProps {
  store: TraceStore;
  interactions: readonly Interaction[];
  /** Full session count shown in the header (may exceed the windowed list). */
  totalCount: number;
  selectedId: string | null;
  t0: number;
  onSelect: (id: string) => void;
}

/**
 * The interactions rail.
 *
 * One line per interaction: a kind pip, the label, and React time. Cost is the
 * row's own background fill rather than a bar in its own column, because the
 * rail's width is width the lens does not get. Renders, components, commits,
 * state updates and wall span all live in the row's tooltip — they were four
 * numbers with no ranking, and none of them is what you scan for.
 */
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
  const [sort, setSort] = useState<RailSortKey>(DEFAULT_RAIL_SORT);

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
    const el = listRef.current.querySelector<HTMLElement>(".rl-cascade-interaction.selected");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId, sort]);

  const rows = buildRailRows(interactions, wasteById, sort, selectedId, t0);

  return (
    <div className="rl-cascade-interactions">
      <div className="rl-cascade-interactions-head">
        <span className="rl-rail-sort" role="tablist" aria-label="Sort interactions">
          {(Object.keys(RAIL_SORTS) as RailSortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={sort === key}
              title={RAIL_SORTS[key].title}
              onClick={() => setSort(key)}
            >
              {RAIL_SORTS[key].label}
            </button>
          ))}
        </span>
        <span className="count">{totalCount.toLocaleString()}</span>
      </div>
      <div className="rl-cascade-interaction-rows" ref={listRef}>
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            className={`rl-cascade-interaction${row.selected ? " selected" : ""}`}
            data-kind={interactionKindTone(row.kind)}
            data-hot={row.hot || undefined}
            aria-selected={row.selected}
            style={{ "--rail-cost": `${(row.costShare * 100).toFixed(1)}%` } as React.CSSProperties}
            onClick={() => onSelect(row.id)}
            title={row.detail}
          >
            <span className={`kind-pip kind-${interactionKindTone(row.kind)}`} aria-hidden="true" />
            <span className="title">{row.label}</span>
            <span className="react">{ms(row.cost)}</span>
            {row.wasted > 0 ? (
              <span
                className="waste-dot"
                aria-label={`${row.wasted.toLocaleString()} wasted renders`}
              />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
