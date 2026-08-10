import type { InspectorContext } from "../Inspector.js";
import { ValueRow, EmptyTab } from "./shared.js";

/** State-bearing hooks (useState / useReducer) with their current values. */
export function StateTab({ ctx }: { ctx: InspectorContext }) {
  const snapshot = ctx.snapshot;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;

  const stateHooks = (snapshot.hooks ?? []).filter(
    (h) => h.kind === "state" || h.kind === "reducer",
  );
  if (stateHooks.length === 0) {
    return <EmptyTab>This component holds no local state.</EmptyTab>;
  }

  return (
    <div className="rl-kv-list">
      {stateHooks.map((h) => (
        <ValueRow key={h.index} name={`${h.kind} #${h.index}`} value={h.value} />
      ))}
    </div>
  );
}
