import type { TraceStore, ApplySetComparison } from "@reactlens/trace-engine";
import type { ComponentId } from "@reactlens/protocol";
import { ms, timeAxis } from "@reactlens/ui";
import { IconClose } from "@reactlens/icons";

const ROW_CAP = 200;

/**
 * Whole-app A→B index: every component whose apply-set entry differs between
 * the two marks. Rows link into the Inspector, whose existing A/B section
 * shows the value-level diff for the selected component.
 */
export function ABDiffPanel({
  store,
  comparison,
  a,
  b,
  onSelectComponent,
  onClose,
}: {
  store: TraceStore;
  comparison: ApplySetComparison;
  a: number;
  b: number;
  onSelectComponent?: (id: ComponentId) => void;
  onClose: () => void;
}) {
  const t0 = Math.min(a, b);
  const t1 = Math.max(a, b);
  // Most active first: renders between the marks approximates churn.
  const rows = [...comparison.changed]
    .map((c) => ({
      ...c,
      name: store.instance(c.componentId)?.name ?? `#${c.componentId}`,
      renders: store
        .rendersOf(c.componentId)
        .filter((r) => r.timestamp > t0 && r.timestamp <= t1),
    }))
    .sort((x, y) => y.renders.length - x.renders.length);
  const shown = rows.slice(0, ROW_CAP);

  return (
    <div className="rl-tl-abpanel">
      <div className="rl-tl-abpanel-head">
        <span className="rl-tl-abpanel-title">
          A→B · {timeAxis(t1 - t0)} · {comparison.changed.length} changed ·{" "}
          {comparison.unchangedCount} unchanged
        </span>
        <span className="rl-spacer" />
        <button className="rl-icon-btn" onClick={onClose} title="Close A/B diff" aria-label="Close A/B diff">
          <IconClose size={12} />
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="rl-empty rl-empty-compact">No component state differs between A and B.</div>
      ) : (
        <div className="rl-tl-abpanel-rows">
          {shown.map((row) => {
            const selfTime = row.renders.reduce((s, r) => s + r.selfDuration, 0);
            const kind = row.renderA === null ? "new" : row.renderB === null ? "gone" : "changed";
            return (
              <button
                key={row.componentId}
                className="rl-tl-abpanel-row"
                onClick={() => onSelectComponent?.(row.componentId)}
                title={
                  kind === "new"
                    ? "No retained render at A — first appears in this range"
                    : kind === "gone"
                      ? "No retained render at B (history evicted)"
                      : "Different render at A vs B — open the Inspector's A/B diff"
                }
              >
                <span className="rl-tl-abpanel-name">{row.name}</span>
                <span className={`rl-badge ${kind === "changed" ? "render" : "warn"}`}>{kind}</span>
                <span className="rl-tl-abpanel-meta">
                  {row.renders.length}× · {ms(selfTime)}
                </span>
              </button>
            );
          })}
          {rows.length > shown.length && (
            <div className="rl-tl-abpanel-more">… {rows.length - shown.length} more</div>
          )}
        </div>
      )}
    </div>
  );
}
