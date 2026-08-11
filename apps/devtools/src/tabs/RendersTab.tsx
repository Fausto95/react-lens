import type { RenderEvent, RenderSnapshot } from "@reactlens/protocol";
import type { InspectorContext } from "../Inspector.js";
import { ms, timeAxis } from "@reactlens/ui";
import { DiffLines, EmptyTab } from "./shared.js";
import { diff, type DiffResult } from "@reactlens/diff-engine";

/**
 * Render history as an activity feed: newest first, each row carrying its
 * cause, position in the session, and a self-time bar. The selected render
 * expands inline with what actually changed vs the previous one (props /
 * state / context diffs from the captured snapshots).
 */
export function RendersTab({
  ctx,
  renders,
}: {
  ctx: InspectorContext;
  renders: RenderEvent[];
}) {
  const { store, activeRenderId, onSelectRender } = ctx;
  if (renders.length === 0) return <EmptyTab>No renders recorded.</EmptyTab>;

  const t0 = renders[0]!.timestamp;
  const maxSelf = Math.max(0.001, ...renders.map((r) => r.selfDuration));
  const newestFirst = [...renders].reverse();

  return (
    <div className="rl-render-feed">
      {newestFirst.map((r) => {
        const idx = renders.findIndex((x) => x.renderId === r.renderId);
        const prev = idx > 0 ? renders[idx - 1]! : null;
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
            {open && <RenderDiff store={store} cur={r} prev={prev} />}
          </div>
        );
      })}
    </div>
  );
}

/** Inline expansion: what this render changed relative to the previous one. */
function RenderDiff({
  store,
  cur,
  prev,
}: {
  store: InspectorContext["store"];
  cur: RenderEvent;
  prev: RenderEvent | null;
}) {
  const curSnap = store.snapshot(cur.renderId);
  if (!curSnap) {
    return <div className="rl-render-note">Snapshot no longer retained for this render.</div>;
  }
  if (!prev) {
    // Mount: everything is "added" — show the initial values as such.
    const initial = diff({ kind: "props", before: UNDEF, after: curSnap.props });
    return (
      <div className="rl-render-diff">
        <DiffGroup title="Mount — initial props" result={initial} />
      </div>
    );
  }
  const prevSnap = store.snapshot(prev.renderId);
  if (!prevSnap) {
    return (
      <div className="rl-render-note">
        Previous render's snapshot no longer retained — nothing to compare.
      </div>
    );
  }
  const groups = diffGroups(prevSnap, curSnap);
  if (groups.every(({ result }) => result.summary.changed === 0)) {
    return (
      <div className="rl-render-note">
        No captured value changed — parent render or reference-only churn.
      </div>
    );
  }
  return (
    <div className="rl-render-diff">
      {groups.map(
        ({ title, result }) =>
          result.summary.changed > 0 && <DiffGroup key={title} title={title} result={result} />,
      )}
    </div>
  );
}

const UNDEF = { k: "undefined" } as const;

function diffGroups(prev: RenderSnapshot, cur: RenderSnapshot) {
  return [
    { title: "Props", result: diff({ kind: "props", before: prev.props, after: cur.props }) },
    {
      title: "State",
      result: diff({ kind: "state", before: prev.state ?? UNDEF, after: cur.state ?? UNDEF }),
    },
    {
      title: "Context",
      result: diff({
        kind: "context",
        before: prev.context ?? UNDEF,
        after: cur.context ?? UNDEF,
      }),
    },
  ];
}

function DiffGroup({ title, result }: { title: string; result: DiffResult }) {
  return (
    <div className="rl-render-diff-group">
      <div className="rl-render-diff-head">
        {title}
        {result.summary.changed > 0 && (
          <span className="rl-render-diff-count">{result.summary.changed}</span>
        )}
      </div>
      <DiffLines result={result} />
    </div>
  );
}

/** "props-changed" → "props"; unknown reasons prettify generically. */
function reasonLabel(type: string): string {
  return type.replace(/-changed$/, "").replace(/-/g, " ");
}

function dedupe(labels: string[]): string[] {
  return [...new Set(labels)];
}
