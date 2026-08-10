import type { InspectorContext } from "../Inspector.js";
import { formatValue } from "@react-lens/ui";
import { EmptyTab } from "./shared.js";

/**
 * Effect hooks with their dependency arrays. A full effect debugger (run/cleanup
 * counts, loop detection §90/§91) needs effect-execution events — tracked as a
 * follow-up; this shows the static effect shape captured per render.
 */
export function EffectsTab({ ctx }: { ctx: InspectorContext }) {
  const snapshot = ctx.snapshot;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;
  const effects = (snapshot.hooks ?? []).filter(
    (h) => h.kind === "effect" || h.kind === "layout-effect",
  );
  if (effects.length === 0) return <EmptyTab>This component has no effects.</EmptyTab>;

  return (
    <div className="rl-hooks">
      {effects.map((h) => (
        <div className="rl-hook" key={h.index}>
          <div className="rl-hook-head">
            <span className="rl-hook-idx">{h.index}</span>
            <span className="rl-badge warn">{h.kind}</span>
          </div>
          <div className="rl-hook-deps">
            deps:{" "}
            {h.deps === null || h.deps === undefined
              ? "none (runs every render)"
              : h.deps.length === 0
                ? "[] (runs once)"
                : `[${h.deps.map((d) => formatValue(d)).join(", ")}]`}
          </div>
        </div>
      ))}
    </div>
  );
}
