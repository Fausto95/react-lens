import type { RenderEvent } from "@react-lens/protocol";
import type { InspectorContext } from "../Inspector.js";
import { ms } from "../format.js";
import { DiffLines, EmptyTab } from "./shared.js";
import { diff } from "@react-lens/diff-engine";

/** Render history with per-render reason and a props diff vs the previous one. */
export function RendersTab({
  ctx,
  renders,
}: {
  ctx: InspectorContext;
  renders: RenderEvent[];
}) {
  const { store, activeRenderId, onSelectRender } = ctx;
  if (renders.length === 0) return <EmptyTab>No renders recorded.</EmptyTab>;

  return (
    <div>
      <div className="rl-render-list">
        {renders.map((r) => (
          <button
            key={r.renderId}
            className={`rl-render-row${r.renderId === activeRenderId ? " active" : ""}`}
            onClick={() => onSelectRender(r.renderId)}
          >
            <span className="rl-render-id">#{String(r.renderId)}</span>
            <span className="rl-render-reason">{r.reasons.map((x) => x.type).join(", ")}</span>
            <span className="rl-render-cost">{ms(r.selfDuration)}</span>
          </button>
        ))}
      </div>

      {activeRenderId !== null && <RenderDetail ctx={ctx} store={store} renderId={activeRenderId} />}
    </div>
  );
}

function RenderDetail({
  ctx,
  store,
  renderId,
}: {
  ctx: InspectorContext;
  store: InspectorContext["store"];
  renderId: InspectorContext["activeRenderId"];
}) {
  if (renderId === null) return null;
  const history = store.rendersOf(ctx.componentId);
  const idx = history.findIndex((r) => r.renderId === renderId);
  if (idx <= 0) return <div className="rl-muted" style={{ marginTop: 8 }}>First render — nothing to compare.</div>;
  const prev = store.snapshot(history[idx - 1]!.renderId);
  const cur = store.snapshot(renderId);
  if (!prev || !cur) return null;
  const result = diff({ kind: "props", before: prev.props, after: cur.props });
  return (
    <>
      <div className="rl-section-title">Props changed vs #{String(history[idx - 1]!.renderId)}</div>
      <DiffLines result={result} />
    </>
  );
}
