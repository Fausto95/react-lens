import type { InspectorContext } from "../Inspector.js";
import { ValueView, type EditFn } from "@react-lens/ui";
import { EmptyTab } from "./shared.js";

/** State-bearing hooks with current values, editable when supported. */
export function StateTab({ ctx }: { ctx: InspectorContext }) {
  const { snapshot, edit, componentId } = ctx;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;

  const stateHooks = (snapshot.hooks ?? []).filter(
    (h) => h.kind === "state" || h.kind === "reducer",
  );
  if (stateHooks.length === 0) return <EmptyTab>This component holds no local state.</EmptyTab>;

  return (
    <div className="rl-val-list">
      {stateHooks.map((h) => {
        const editFn: EditFn | undefined =
          edit && h.kind === "state"
            ? (path, value) => edit.setHookState(componentId, h.index, path, value)
            : undefined;
        return (
          <div className="rl-val-row" key={h.index}>
            <span className="rl-val-key">
              {h.kind} #{h.index}
            </span>
            {h.value ? (
              <ValueView value={h.value} edit={editFn} />
            ) : (
              <span className="rl-val rl-muted">—</span>
            )}
            {edit && h.kind === "reducer" && (
              <span
                className="rl-badge dim"
                title="Reducer state can only change through dispatched actions — direct writes would bypass the reducer."
              >
                read-only
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
