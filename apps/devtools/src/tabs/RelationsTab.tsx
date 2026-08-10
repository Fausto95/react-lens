import { useMemo } from "react";
import type { ComponentId } from "@react-lens/protocol";
import { buildGraph, neighbors, componentKey, type Graph } from "@react-lens/graph";
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
  const graph = useMemo(() => buildGraphFromStore(store), [store, componentId]);
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

  const label = (key: string) => graph.nodes.get(key)?.label ?? key;
  const refOf = (key: string) => graph.nodes.get(key)?.ref;

  const Group = ({ title, keys }: { title: string; keys: string[] }) => {
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
                if (clickable) onSelectComponent(refOf(key) as ComponentId);
              }}
            >
              <span className={`rl-rel-dot ${node?.kind ?? ""}`} />
              {label(key)}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rl-rel">
      <Group title="Parent" keys={parents} />
      <Group title="Children" keys={children} />
      <Group title="Rendered because of" keys={causedBy} />
      <Group title="Triggers renders of" keys={causes} />
      <Group title="Reads context" keys={readsContext} />
    </div>
  );
}

function buildGraphFromStore(store: InspectorContext["store"]): Graph {
  const components = store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => ({ id: i.id, name: i.name, ...(i.parentId !== undefined ? { parentId: i.parentId } : {}) }));

  const renders = components.map((c) => {
    const last = store.rendersOf(c.id).at(-1);
    return { componentId: c.id, reasons: last ? last.reasons : [] };
  });

  return buildGraph({ components, renders });
}
