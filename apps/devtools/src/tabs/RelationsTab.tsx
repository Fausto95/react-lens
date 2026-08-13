import { useMemo } from "react";
import type { ComponentId } from "@reactlens/protocol";
import { buildGraph, neighbors, componentKey, type Graph } from "@reactlens/graph";
import type { InspectorContext } from "../Inspector.js";
import { EmptyTab } from "./shared.js";

/**
 * Focus Lens for the selected component: its neighbors in the unified graph —
 * parent, children, render-causality both directions, and consumed contexts.
 * Uses the graph package's focus()/neighbors() over a graph built from the
 * current trace.
 */
export function RelationsTab({ ctx }: { ctx: InspectorContext }) {
  const { store, componentId, onSelectComponent } = ctx;
  const graph = useMemo(() => buildGraphFromStore(store), [store]);
  const self = componentKey(componentId);
  const { incoming, outgoing } = neighbors(graph, self);

  const parents = outgoing.filter((e) => e.kind === "parent").map((e) => e.to);
  const children = incoming.filter((e) => e.kind === "parent").map((e) => e.from);
  const causedBy = incoming.filter((e) => e.kind === "renders").map((e) => e.from);
  const causes = outgoing.filter((e) => e.kind === "renders").map((e) => e.to);
  const readsContext = incoming.filter((e) => e.kind === "reads-context").map((e) => e.from);

  const anything =
    parents.length + children.length + causedBy.length + causes.length + readsContext.length;
  if (anything === 0) return <EmptyTab>No relations captured for this component.</EmptyTab>;

  return (
    <div className="rl-rel">
      <RelationGroup
        title="Parent"
        keys={parents}
        graph={graph}
        onSelectComponent={onSelectComponent}
      />
      <RelationGroup
        title="Children"
        keys={children}
        graph={graph}
        onSelectComponent={onSelectComponent}
      />
      <RelationGroup
        title="Rendered because of"
        keys={causedBy}
        graph={graph}
        onSelectComponent={onSelectComponent}
      />
      <RelationGroup
        title="Triggers renders of"
        keys={causes}
        graph={graph}
        onSelectComponent={onSelectComponent}
      />
      <RelationGroup
        title="Reads context"
        keys={readsContext}
        graph={graph}
        onSelectComponent={onSelectComponent}
      />
    </div>
  );
}

/**
 * Module-level on purpose: defined inside RelationsTab it was a NEW component
 * type every render, so React remounted the whole group subtree per render —
 * any ingest between pointerup and click left the click on a detached button.
 */
function RelationGroup({
  title,
  keys,
  graph,
  onSelectComponent,
}: {
  title: string;
  keys: string[];
  graph: Graph;
  onSelectComponent: ((id: ComponentId) => void) | undefined;
}) {
  if (keys.length === 0) return null;
  const unique = [...new Set(keys)];
  return (
    <div className="rl-rel-group">
      <div className="rl-rel-title">{title}</div>
      {unique.map((key) => {
        const node = graph.nodes.get(key);
        const clickable = node?.kind === "component" && onSelectComponent;
        return (
          <button
            key={key}
            className={`rl-rel-item${clickable ? " link" : ""}`}
            onClick={() => {
              if (clickable) onSelectComponent(node.ref as ComponentId);
            }}
          >
            <span className={`rl-rel-dot ${node?.kind ?? ""}`} />
            {node?.label ?? key}
          </button>
        );
      })}
    </div>
  );
}

function buildGraphFromStore(store: InspectorContext["store"]): Graph {
  const components = store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => ({
      id: i.id,
      name: i.name,
      ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
    }));

  const renders = components.map((c) => {
    const last = store.rendersOf(c.id).at(-1);
    return { componentId: c.id, reasons: last ? last.reasons : [] };
  });

  return buildGraph({ components, renders });
}
