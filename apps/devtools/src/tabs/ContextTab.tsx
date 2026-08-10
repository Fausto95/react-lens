import { diff } from "@react-lens/diff-engine";
import type { InspectorContext } from "../Inspector.js";
import { formatValue } from "../format.js";
import { EmptyTab } from "./shared.js";

/**
 * Contexts this component consumes, with current values and a flag when the
 * value changed identity vs the previous render (the context-fanout signal).
 */
export function ContextTab({ ctx }: { ctx: InspectorContext }) {
  const { store, componentId, activeRenderId, snapshot } = ctx;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;
  const contexts = snapshot.contexts ?? [];
  if (contexts.length === 0) return <EmptyTab>This component consumes no context.</EmptyTab>;

  const changed = contextChanged(store, componentId, activeRenderId);

  return (
    <div className="rl-kv-list">
      {contexts.map((c, i) => (
        <div className="rl-kv" key={i}>
          <span className="rl-kv-key">{c.displayName ?? `Context #${i}`}</span>
          <span className="rl-kv-val">{formatValue(c.value)}</span>
          {changed && <span className="rl-badge warn">changed</span>}
        </div>
      ))}
    </div>
  );
}

function contextChanged(
  store: InspectorContext["store"],
  componentId: InspectorContext["componentId"],
  activeRenderId: InspectorContext["activeRenderId"],
): boolean {
  if (activeRenderId === null) return false;
  const history = store.rendersOf(componentId);
  const idx = history.findIndex((r) => r.renderId === activeRenderId);
  if (idx <= 0) return false;
  const prev = store.snapshot(history[idx - 1]!.renderId);
  const cur = store.snapshot(activeRenderId);
  if (!prev?.context || !cur?.context) return false;
  return diff({ kind: "context", before: prev.context, after: cur.context }).summary.changed > 0;
}
