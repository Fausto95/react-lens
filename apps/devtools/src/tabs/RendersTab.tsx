import type { RenderEvent } from "@reactlens/protocol";
import type { InspectorContext } from "../Inspector.js";
import { ms, timeAxis } from "@reactlens/ui";
import { EmptyTab } from "./shared.js";
import { changesForRender, type ChangeRow } from "../inspector/renderStory.js";

/**
 * Render history as an activity feed: newest first. Expanding a row shows the
 * same Change diff the clip inspector uses (props / state / context rows with
 * @ref chips), so the two views stay in lockstep.
 */
export function RendersTab({ ctx, renders }: { ctx: InspectorContext; renders: RenderEvent[] }) {
  const { store, activeRenderId, onSelectRender } = ctx;
  if (renders.length === 0) return <EmptyTab>No renders recorded.</EmptyTab>;

  const t0 = renders[0]!.timestamp;
  const maxSelf = Math.max(0.001, ...renders.map((r) => r.selfDuration));
  const newestFirst = [...renders].reverse();

  return (
    <div className="rl-render-feed">
      {newestFirst.map((r) => {
        const idx = renders.findIndex((x) => x.renderId === r.renderId);
        const open = r.renderId === activeRenderId;
        return (
          <div key={r.renderId} className={`rl-render-item${open ? " open" : ""}`}>
            <button
              type="button"
              className={`rl-render-row${open ? " active" : ""}`}
              onClick={() => onSelectRender(r.renderId)}
              aria-expanded={open}
            >
              <span className="rl-render-id">#{idx + 1}</span>
              <span className="rl-render-reasons">
                {dedupe(r.reasons.map((x) => reasonLabel(x.type))).map((label) => (
                  <span key={label} className={`rl-render-chip rl-rr-${label.replace(/\s/g, "-")}`}>
                    {label}
                  </span>
                ))}
              </span>
              <span className="rl-render-when">+{timeAxis(Math.max(0, r.timestamp - t0))}</span>
              <span className="rl-render-heat" aria-hidden>
                <span style={{ width: `${(r.selfDuration / maxSelf) * 100}%` }} />
              </span>
              <span className="rl-render-cost">{ms(r.selfDuration)}</span>
            </button>
            {open && <RenderChangeDiff store={store} renderId={r.renderId} />}
          </div>
        );
      })}
    </div>
  );
}

/** Same Change block the clip inspector paints for a selected render. */
function RenderChangeDiff({
  store,
  renderId,
}: {
  store: InspectorContext["store"];
  renderId: RenderEvent["renderId"];
}) {
  const { changes, refWarning } = changesForRender(store, renderId);
  if (!store.snapshot(renderId)) {
    return <div className="rl-render-note">Snapshot no longer retained for this render.</div>;
  }
  return (
    <div className="rl-render-diff">
      <ChangeDiffRows changes={changes} refWarning={refWarning} />
    </div>
  );
}

export function ChangeDiffRows({
  changes,
  refWarning,
}: {
  changes: ChangeRow[];
  refWarning: string | null;
}) {
  return (
    <>
      {changes.length === 0 ? (
        <div className="diff">
          <div className="row neutral">· nothing captured for this render</div>
        </div>
      ) : (
        <div className="diff">
          {changes.map((change, i) => (
            <div
              key={i}
              className={`row ${change.kind === "removed" ? "del" : change.kind === "added" ? "add" : "neutral"}`}
            >
              {change.text}
              {change.identity && <span className="refchip"> @ref {change.identity}</span>}
            </div>
          ))}
        </div>
      )}
      {refWarning && (
        <div className="refwarn">
          ⚠ <span>{refWarning}</span>
        </div>
      )}
    </>
  );
}

/** "props-changed" → "props"; unknown reasons prettify generically. */
function reasonLabel(type: string): string {
  return type.replace(/-changed$/, "").replace(/-/g, " ");
}

function dedupe(labels: string[]): string[] {
  return [...new Set(labels)];
}
