import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { ComponentId } from "@reactlens/protocol";
import { IconChevronLeft, IconChevronRight, IconCollapse, IconLive } from "@reactlens/icons";
import { typeLaneKey } from "../laneFilter.js";
import type { TimeCursor } from "../timeCursor.js";
import type { Timeline as TimelineModel } from "./useTimeline.js";
import {
  aggregateExpansionKey,
  buildCascadeProjection,
  cascadeBaseName,
  type CascadeAggregateNode,
  type CascadeNode,
  type CascadeProjection,
} from "./model.js";
import { LedgerView } from "./LedgerView.js";
import { RollupView } from "./RollupView.js";
import { InteractionList } from "./InteractionList.js";
import "./cascade.css";
import "./transport.css";

/**
 * Cascade — two readings of one interaction's render cascade.
 *
 * The projection is a tree (every render has exactly one parent), so both
 * lenses are derived from the same `CascadeProjection` with no layout pass and
 * no canvas: the ledger reads it top-to-bottom at any size, and the roll-up
 * ranks components by what they cost. Selection and the filter are shared, so a
 * pick in one lens lands in the other and in the inspector.
 */
type CascadeLens = "ledger" | "rollup";

const LENSES: readonly { id: CascadeLens; label: string; title: string }[] = [
  { id: "ledger", label: "Ledger", title: "Indented list — the whole cascade in reading order" },
  { id: "rollup", label: "Roll-up", title: "One row per component — what to fix" },
];

const DEFAULT_LENS: CascadeLens = "ledger";

const LENS_HELP: Record<CascadeLens, string> = {
  ledger: "↑/↓ move · ←/→ fold · double-click a row to fold · type to filter",
  rollup: "click a column to sort · click a row to drill into that component",
};

export interface CascadeProps {
  store: TraceStore;
  model: TimelineModel;
  cursor: TimeCursor;
  onCursor: (cursor: TimeCursor) => void;
  onSelectComponent?: (id: ComponentId) => void;
  onHighlight?: (id: ComponentId | null) => void;
  transport?: ReactNode;
  /** Components the Doctor flagged. Surfaced as a ⚠ beside the name. */
  flagged?: ReadonlySet<ComponentId>;
  /** Hand a component to the AI panel from a lens row. */
  onAddToAgent?: (id: ComponentId, name: string) => void;
}

function containingInteraction(
  interactions: TimelineModel["interactions"],
  time: number,
): TimelineModel["interactions"][number] | null {
  if (interactions.length === 0) return null;
  let lo = 0;
  let hi = interactions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (interactions[mid]!.start <= time) lo = mid + 1;
    else hi = mid;
  }
  return interactions[Math.max(0, lo - 1)] ?? interactions[0]!;
}

function interactionWindow<T extends { id: string }>(
  items: readonly T[],
  selectedId: string | null,
): T[] {
  const max = 180;
  if (items.length <= max) return [...items];
  const selected =
    selectedId === null ? items.length - 1 : items.findIndex((item) => item.id === selectedId);
  const center = selected < 0 ? items.length - 1 : selected;
  const start = Math.max(0, Math.min(items.length - max, center - Math.floor(max / 2)));
  return items.slice(start, start + max);
}

function Island({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rl-cascade-island${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

function Tool({
  title,
  label,
  active,
  disabled,
  className,
  onClick,
  children,
}: {
  title: string;
  /** Accessible name, when the tooltip is a sentence rather than a name. */
  label?: string;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rl-cascade-tool${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      title={title}
      aria-label={label ?? title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Cascade({
  store,
  model,
  cursor,
  onCursor,
  onSelectComponent,
  onHighlight,
  transport,
  flagged,
  onAddToAgent,
}: CascadeProps) {
  const latest = model.interactions[model.interactions.length - 1] ?? null;
  const initial = containingInteraction(model.interactions, cursor.t) ?? latest;
  /** An interaction the user picked explicitly; `null` while following. */
  const [pinnedInteractionId, setPinnedInteractionId] = useState<string | null>(
    initial?.id === latest?.id ? null : (initial?.id ?? null),
  );
  const [expandedAggregates, setExpandedAggregates] = useState<ReadonlySet<string>>(new Set());
  /** An aggregate clip has no render id, so it is pinned here instead. */
  const [pinnedAggregateId, setPinnedAggregateId] = useState<string | null>(null);
  const [lens, setLens] = useState<CascadeLens>(DEFAULT_LENS);
  const [query, setQuery] = useState("");

  /**
   * Which interaction is on screen is *derived*, never mirrored into state:
   *
   * 1. the interaction owning the selected render — so picking a component in
   *    the tree or the inspector navigates here on its own,
   * 2. otherwise the one the user pinned,
   * 3. otherwise the latest, which is what "follow latest" means.
   *
   * `chooseInteraction` clears the selected render first, so rule 1 can never
   * fight an explicit choice. Nothing has to be synchronised in an effect.
   */
  const selectedRenderId = model.state.selectedRender;
  const renderInteraction =
    selectedRenderId === null
      ? null
      : containingInteraction(
          model.interactions,
          store.getRender(selectedRenderId)?.timestamp ?? Number.NaN,
        );
  const interaction =
    renderInteraction ??
    (pinnedInteractionId === null
      ? latest
      : (model.interactions.find((item) => item.id === pinnedInteractionId) ?? latest)) ??
    null;
  const followLatest = interaction !== null && interaction.id === latest?.id;

  /**
   * Only the selected interaction is ever projected. `model.interactions` comes
   * from a derivation cache keyed on the store version, so an interaction keeps
   * its identity until the trace actually changes — which is exactly when the
   * projection should be rebuilt.
   */
  const projection = useMemo<CascadeProjection | null>(
    () =>
      interaction === null
        ? null
        : buildCascadeProjection(store, interaction, {
            aggregateThreshold: 6,
            maxVisibleNodes: 1_200,
            expandedAggregateKeys: expandedAggregates,
          }),
    [expandedAggregates, interaction, store],
  );

  // A live render selection outranks a pinned aggregate: selecting an aggregate
  // clears the clip, so only one of the two is ever set.
  const selectedId =
    selectedRenderId === null ? pinnedAggregateId : `r:${selectedRenderId as number}`;
  const selectedNode = projection?.nodes.find((node) => node.id === selectedId) ?? null;
  /** Roll-up rows are keyed by component, so selection crosses over by name. */
  const selectedNodeName = selectedNode ? cascadeBaseName(selectedNode) : null;

  /** The one way a cascade node becomes the panel's selection, from any lens. */
  const selectNode = useCallback(
    (node: CascadeNode) => {
      if (node.kind === "aggregate") {
        model.dispatch({ type: "clearClip" });
        setPinnedAggregateId(node.id);
        const key = aggregateExpansionKey(node as CascadeAggregateNode);
        if (key) setExpandedAggregates((previous) => new Set(previous).add(key));
        return;
      }
      setPinnedAggregateId(null);
      model.dispatch({
        type: "selectClip",
        renderId: node.renderId,
        laneKey: typeLaneKey(node.name),
      });
      onSelectComponent?.(node.componentId);
    },
    [model, onSelectComponent],
  );

  const hoverNode = useCallback(
    (node: CascadeNode | null) => onHighlight?.(node?.componentId ?? null),
    [onHighlight],
  );

  const collapseGroups = useCallback(() => {
    setExpandedAggregates((previous) => (previous.size === 0 ? previous : new Set()));
    setPinnedAggregateId(null);
  }, []);

  const chooseInteraction = useCallback(
    (id: string) => {
      const next = model.interactions.find((item) => item.id === id);
      if (!next) return;
      // A selected render belongs to the previous interaction. Clear it first so
      // the selected-render synchronization effect cannot immediately navigate
      // Cascade back to that interaction after this explicit user choice.
      model.dispatch({ type: "clearClip" });
      setPinnedInteractionId(id === latest?.id ? null : id);
      setExpandedAggregates(new Set());
      setPinnedAggregateId(null);
      onCursor({ mode: "historical", t: next.start });
    },
    [latest?.id, model, onCursor],
  );

  const stepInteraction = useCallback(
    (delta: number) => {
      if (!interaction || model.interactions.length === 0) return;
      const index = model.interactions.findIndex((item) => item.id === interaction.id);
      const next =
        model.interactions[Math.max(0, Math.min(model.interactions.length - 1, index + delta))];
      if (next) chooseInteraction(next.id);
    },
    [chooseInteraction, interaction, model.interactions],
  );

  const interactions = interactionWindow(model.interactions, interaction?.id ?? null);
  const footer = projection
    ? `${projection.totalRenderCount.toLocaleString()} renders · ${projection.totalSelfTime.toFixed(1)}ms self · depth ${projection.maxDepth}${projection.aggregatedRenderCount ? ` · ${projection.aggregatedRenderCount.toLocaleString()} aggregated` : ""}`
    : "No interaction data";

  return (
    <div className="rl-cascade">
      <div className="rl-cascade-toolbar">
        <Island label="Interactions">
          <Tool title="Previous interaction" onClick={() => stepInteraction(-1)}>
            <IconChevronLeft size={14} />
          </Tool>
          <Tool title="Next interaction" onClick={() => stepInteraction(1)}>
            <IconChevronRight size={14} />
          </Tool>
        </Island>
        <span className="rl-cascade-sep" aria-hidden="true" />
        <Island className="rl-cascade-seg rl-cascade-lens" label="Lens">
          {LENSES.map((item) => (
            <Tool
              key={item.id}
              className={`rl-cascade-tool-text rl-cascade-lens-${item.id}`}
              title={item.title}
              label={item.label}
              active={lens === item.id}
              onClick={() => setLens(item.id)}
            >
              {item.label}
            </Tool>
          ))}
        </Island>
        <span className="rl-cascade-sep rl-cascade-sep-kind" aria-hidden="true" />
        <span className="rl-cascade-pill">{interaction?.label ?? "idle"}</span>
        {expandedAggregates.size > 0 ? (
          <Tool title="Collapse all expanded render groups" onClick={collapseGroups}>
            <IconCollapse size={14} />
          </Tool>
        ) : null}
        <span className="spacer" />
        <div className="rl-cascade-trailing">
          {transport}
          <button
            type="button"
            className={`rl-cascade-latest${followLatest ? " active" : ""}`}
            title="Follow the latest interaction"
            aria-label="Follow the latest interaction"
            aria-pressed={followLatest}
            onClick={() => {
              if (latest) chooseInteraction(latest.id);
            }}
          >
            <IconLive size={12} />
            <span className="rl-cascade-latest-label">Latest</span>
          </button>
        </div>
      </div>

      <div className="rl-cascade-body">
        <InteractionList
          store={store}
          interactions={interactions}
          totalCount={model.interactions.length}
          selectedId={interaction?.id ?? null}
          t0={model.bounds.t0}
          onSelect={chooseInteraction}
        />

        {lens === "ledger" ? (
          <LedgerView
            key={interaction?.id ?? "none"}
            projection={projection}
            selectedId={selectedId}
            query={query}
            onQuery={setQuery}
            onSelect={selectNode}
            onHover={hoverNode}
            {...(flagged ? { flagged } : {})}
            {...(onAddToAgent ? { onAddToAgent } : {})}
          />
        ) : null}
        {lens === "rollup" ? (
          <RollupView
            projection={projection}
            selectedName={selectedNodeName}
            query={query}
            onQuery={setQuery}
            onSelect={selectNode}
            onHover={hoverNode}
            {...(flagged ? { flagged } : {})}
            {...(onAddToAgent ? { onAddToAgent } : {})}
          />
        ) : null}
      </div>

      <div className="rl-cascade-footer">
        <span>{footer}</span>
        <span className="spacer" />
        <span className="rl-cascade-help">{LENS_HELP[lens]}</span>
      </div>
    </div>
  );
}
