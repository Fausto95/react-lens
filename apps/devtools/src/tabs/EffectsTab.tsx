import type { InspectorContext } from "../Inspector.js";
import { formatValue, ms } from "@react-lens/ui";
import { EmptyTab } from "./shared.js";
import { useTraceVersion } from "../useLens.js";

/**
 * Effect hooks with dependency arrays + timed run/cleanup counts from
 * post-commit EffectEvents (fiber create/destroy wraps).
 */
export function EffectsTab({ ctx }: { ctx: InspectorContext }) {
  useTraceVersion(ctx.store, { kind: "component", id: ctx.componentId });
  const snapshot = ctx.snapshot;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;
  const effects = (snapshot.hooks ?? []).filter(
    (h) => h.kind === "effect" || h.kind === "layout-effect",
  );
  if (effects.length === 0) return <EmptyTab>This component has no effects.</EmptyTab>;

  const effectEvents = ctx.store
    .allEvents()
    .filter(
      (e): e is Extract<typeof e, { type: "effect" }> =>
        e.type === "effect" && e.componentId === ctx.componentId,
    );
  const runs = effectEvents.filter((e) => e.phase === "run");
  const cleanups = effectEvents.filter((e) => e.phase === "cleanup");
  const totalRunMs = runs.reduce((s, e) => s + e.duration, 0);
  const renders = ctx.store.rendersOf(ctx.componentId);
  const recentRenders = renders.slice(-12);
  const runsEveryCommit =
    recentRenders.length >= 4 && runs.length >= recentRenders.length - 1;

  return (
    <div className="rl-hooks">
      <div className="rl-effect-summary">
        <span className="rl-badge warn">
          {runs.length} runs · {cleanups.length} cleanups
        </span>
        {totalRunMs > 0 && (
          <span className="rl-badge dim">{ms(totalRunMs)} in effects</span>
        )}
        {runsEveryCommit && (
          <span className="rl-badge suspicious" title="Effect ran on nearly every recent render">
            possible loop
          </span>
        )}
      </div>
      {effects.map((h) => {
        const everyRender = h.deps === null || h.deps === undefined;
        const hookRuns = runs.filter((e) => e.hookIndex === h.index);
        const hookMs = hookRuns.reduce((s, e) => s + e.duration, 0);
        return (
          <div className="rl-hook" key={h.index}>
            <div className="rl-hook-head">
              <span className="rl-hook-idx">{h.index}</span>
              <span className="rl-badge warn">{h.kind}</span>
              {everyRender && (
                <span className="rl-badge suspicious">every render</span>
              )}
              {hookRuns.length > 0 && (
                <span className="rl-hook-val">
                  {hookRuns.length}×{hookMs > 0 ? ` · ${ms(hookMs)}` : ""}
                </span>
              )}
            </div>
            <div className="rl-hook-deps">
              deps:{" "}
              {everyRender
                ? "none (runs every render)"
                : h.deps!.length === 0
                  ? "[] (runs once)"
                  : `[${h.deps!.map((d) => formatValue(d)).join(", ")}]`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
