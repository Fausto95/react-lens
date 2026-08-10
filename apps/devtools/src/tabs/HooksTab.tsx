import type { HookKind } from "@react-lens/protocol";
import type { InspectorContext } from "../Inspector.js";
import { formatValue } from "../format.js";
import { EmptyTab } from "./shared.js";

const KIND_COLOR: Partial<Record<HookKind, string>> = {
  state: "render",
  reducer: "render",
  effect: "warn",
  "layout-effect": "warn",
  memo: "healthy",
  callback: "suspicious",
  ref: "dim",
  context: "healthy",
};

/** Every hook in order, with inferred kind, value, and deps. */
export function HooksTab({ ctx }: { ctx: InspectorContext }) {
  const snapshot = ctx.snapshot;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;
  const hooks = snapshot.hooks ?? [];
  if (hooks.length === 0) return <EmptyTab>This component uses no hooks.</EmptyTab>;

  return (
    <div className="rl-hooks">
      {hooks.map((h) => (
        <div className="rl-hook" key={h.index}>
          <div className="rl-hook-head">
            <span className="rl-hook-idx">{h.index}</span>
            <span className={`rl-badge ${KIND_COLOR[h.kind] ?? "dim"}`}>{h.kind}</span>
            {h.value !== undefined && <span className="rl-hook-val">{formatValue(h.value)}</span>}
          </div>
          {h.deps !== undefined && (
            <div className="rl-hook-deps">
              deps:{" "}
              {h.deps === null
                ? "none"
                : h.deps.length === 0
                  ? "[] (once)"
                  : `[${h.deps.map((d) => formatValue(d)).join(", ")}]`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
