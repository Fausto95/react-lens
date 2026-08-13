import type { InspectorContext } from "../Inspector.js";
import { formatValue, ms } from "@reactlens/ui";
import { EmptyTab } from "./shared.js";
import { useTraceVersion } from "../useLens.js";
import { readFresh } from "../useDerived.js";

/**
 * Effect hooks with a mini run/cleanup sparkline and dependency summary.
 */
export function EffectsTab({ ctx }: { ctx: InspectorContext }) {
  const version = useTraceVersion(ctx.store, { kind: "component", id: ctx.componentId });
  const snapshot = ctx.snapshot;
  if (!snapshot) return <EmptyTab>No snapshot for this render.</EmptyTab>;
  const effects = (snapshot.hooks ?? []).filter(
    (h) => h.kind === "effect" || h.kind === "layout-effect",
  );
  if (effects.length === 0) return <EmptyTab>No effects on this component.</EmptyTab>;

  // Through the version, or the Compiler caches this on the store's identity and
  // the sparkline stops moving after the first render it saw.
  const effectEvents = readFresh(version, () =>
    ctx.store
      .allEvents()
      .filter(
        (e): e is Extract<typeof e, { type: "effect" }> =>
          e.type === "effect" && e.componentId === ctx.componentId,
      ),
  );
  const runs = effectEvents.filter((e) => e.phase === "run");
  const cleanups = effectEvents.filter((e) => e.phase === "cleanup");
  const totalRunMs = runs.reduce((s, e) => s + e.duration, 0);
  const renders = readFresh(version, () => ctx.store.rendersOf(ctx.componentId));
  const recentRenders = renders.slice(-12);
  const runsEveryCommit = recentRenders.length >= 4 && runs.length >= recentRenders.length - 1;
  const maxDur = Math.max(1, ...runs.map((e) => e.duration), ...cleanups.map((e) => e.duration));

  return (
    <div className="rl-effects">
      <div className="rl-effect-summary">
        <span className="rl-insp-chip">
          {runs.length} runs · {cleanups.length} cleanups
        </span>
        {totalRunMs > 0 && <span className="rl-insp-chip">{ms(totalRunMs)}</span>}
        {runsEveryCommit && (
          <span className="rl-insp-chip warn" title="Effect ran on nearly every recent render">
            possible loop
          </span>
        )}
      </div>

      {runs.length > 0 && (
        <div className="rl-effect-spark" title="Recent effect runs (height = duration)">
          {runs.slice(-24).map((e, i) => (
            <span
              key={`r${i}`}
              className="rl-effect-spark-bar run"
              style={{ height: `${Math.max(12, (e.duration / maxDur) * 100)}%` }}
              title={`run · ${ms(e.duration)}`}
            />
          ))}
          {cleanups.slice(-12).map((e, i) => (
            <span
              key={`c${i}`}
              className="rl-effect-spark-bar cleanup"
              style={{ height: `${Math.max(8, (e.duration / maxDur) * 100)}%` }}
              title={`cleanup · ${ms(e.duration)}`}
            />
          ))}
        </div>
      )}

      {effects.map((h) => {
        const everyRender = h.deps === null || h.deps === undefined;
        const hookRuns = runs.filter((e) => e.hookIndex === h.index);
        const hookMs = hookRuns.reduce((s, e) => s + e.duration, 0);
        return (
          <div className="rl-effect-row" key={h.index}>
            <div className="rl-effect-row-head">
              <span className="rl-hook-idx">{h.index}</span>
              <span className="rl-chip dim">{h.kind}</span>
              {everyRender && <span className="rl-chip warn">every render</span>}
              {hookRuns.length > 0 && (
                <span className="rl-effect-row-ms">
                  {hookRuns.length}×{hookMs > 0 ? ` · ${ms(hookMs)}` : ""}
                </span>
              )}
            </div>
            <div className="rl-effect-deps">
              {everyRender
                ? "deps: none"
                : h.deps!.length === 0
                  ? "deps: [] once"
                  : `deps: [${h.deps!.map((d) => formatValue(d)).join(", ")}]`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
