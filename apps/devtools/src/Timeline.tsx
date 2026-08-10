import { useMemo } from "react";
import type { TraceStore, CommitSummary } from "@react-lens/trace-engine";
import type { ComponentId, CommitId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "./format.js";

const MAX_TICKS = 120;

/**
 * Commit timeline / scrubber. Each tick is a commit, height by self-time.
 * Selecting one freezes it (Freeze Frame) — the tree then marks which
 * components rendered in that commit and shows a diff vs the previous one.
 */
export function Timeline({
  store,
  frozen,
  onFreeze,
  onReplay,
}: {
  store: TraceStore;
  frozen: CommitId | null;
  onFreeze: (id: CommitId | null) => void;
  onReplay?: (ids: ComponentId[]) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const commits = useMemo(() => store.commits().slice(-MAX_TICKS), [store, version]);
  const maxSelf = useMemo(() => Math.max(1, ...commits.map((c) => c.totalSelfTime)), [commits]);

  if (commits.length === 0) {
    return <div className="rl-timeline rl-timeline-empty">No commits yet — interact with the page.</div>;
  }

  const frozenIdx = commits.findIndex((c) => c.commitId === frozen);
  const frozenCommit = frozenIdx >= 0 ? commits[frozenIdx]! : null;
  const prevCommit = frozenIdx > 0 ? commits[frozenIdx - 1]! : null;
  const diff = frozenCommit ? commitDiff(prevCommit, frozenCommit) : null;

  return (
    <div className="rl-timeline-wrap">
      <div className="rl-timeline">
        {commits.map((c) => (
          <button
            key={c.commitId}
            className={`rl-tick${c.commitId === frozen ? " active" : ""}`}
            title={`Commit #${c.commitId} · ${c.componentIds.length} rendered · ${ms(c.totalSelfTime)}`}
            style={{ height: `${8 + (c.totalSelfTime / maxSelf) * 22}px` }}
            onClick={() => onFreeze(c.commitId === frozen ? null : c.commitId)}
          />
        ))}
      </div>
      {frozenCommit && diff && (
        <div className="rl-freeze">
          <span className="rl-freeze-label">
            Frozen · commit #{frozenCommit.commitId}
          </span>
          <span className="rl-freeze-stat">{frozenCommit.componentIds.length} rendered</span>
          {diff.added > 0 && <span className="rl-freeze-stat added">+{diff.added} vs prev</span>}
          {diff.gone > 0 && <span className="rl-freeze-stat gone">−{diff.gone}</span>}
          {onReplay && (
            <button className="rl-btn rl-replay" onClick={() => onReplay(frozenCommit.componentIds)}>
              ▶ Replay
            </button>
          )}
          <button className="rl-btn" onClick={() => onFreeze(null)}>
            Exit
          </button>
        </div>
      )}
    </div>
  );
}

/** Which components rendered in `cur` but not `prev`, and vice-versa. */
function commitDiff(prev: CommitSummary | null, cur: CommitSummary): { added: number; gone: number } {
  const prevSet = new Set(prev?.componentIds ?? []);
  const curSet = new Set(cur.componentIds);
  let added = 0;
  let gone = 0;
  for (const id of curSet) if (!prevSet.has(id)) added++;
  for (const id of prevSet) if (!curSet.has(id)) gone++;
  return { added, gone };
}
