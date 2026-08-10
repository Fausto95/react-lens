import { useMemo, useRef, useState, useEffect } from "react";
import type { TraceStore, CommitSummary } from "@react-lens/trace-engine";
import type { ComponentId, CommitId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "./format.js";

const MIN_BAR = 4;
const MAX_BAR = 28;
const TRACK_H = 56;

function heatColor(ms: number): string {
  if (ms < 1) return "74,222,128"; // green
  if (ms < 5) return "251,191,36"; // yellow
  if (ms < 16) return "251,146,60"; // orange
  return "248,113,113"; // red
}

/**
 * Commit timeline. A zoomable, pannable track of commit bars (height + color by
 * self-time). Click a bar to freeze that commit — the tree then shows Freeze
 * Frame + Tree Diff; Replay animates that commit's update wave on the page.
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
  const commits = useMemo(() => store.commits(), [store, version]);
  const maxSelf = useMemo(() => Math.max(1, ...commits.map((c) => c.totalSelfTime)), [commits]);
  const [barWidth, setBarWidth] = useState(8);
  const trackRef = useRef<HTMLDivElement>(null);

  const frozenIdx = commits.findIndex((c) => c.commitId === frozen);
  const frozenCommit = frozenIdx >= 0 ? commits[frozenIdx]! : null;
  const prevCommit = frozenIdx > 0 ? commits[frozenIdx - 1]! : null;
  const diff = frozenCommit ? commitDiff(prevCommit, frozenCommit) : null;

  // Keep the frozen bar in view.
  useEffect(() => {
    if (frozenIdx < 0 || !trackRef.current) return;
    const x = frozenIdx * (barWidth + 1);
    const el = trackRef.current;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) {
      el.scrollTo({ left: x - el.clientWidth / 2, behavior: "smooth" });
    }
  }, [frozenIdx, barWidth]);

  const zoom = (delta: number) =>
    setBarWidth((w) => Math.max(MIN_BAR, Math.min(MAX_BAR, w + delta)));

  const onWheel = (e: React.WheelEvent) => {
    const el = trackRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) {
      zoom(e.deltaY < 0 ? 2 : -2); // pinch/ctrl-wheel to zoom
    } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY; // vertical wheel → horizontal pan
    }
  };

  return (
    <div className="rl-timeline-wrap">
      <div className="rl-timeline-head">
        <span className="rl-timeline-title">Timeline</span>
        <span className="rl-timeline-sub">{commits.length} commits</span>
        <span className="rl-spacer" />
        <div className="rl-zoom">
          <button className="rl-zoom-btn" onClick={() => zoom(-4)} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button className="rl-zoom-btn" onClick={() => zoom(4)} title="Zoom in" aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      {commits.length === 0 ? (
        <div className="rl-timeline-empty">No commits yet — interact with the page.</div>
      ) : (
        <div className="rl-track" ref={trackRef} onWheel={onWheel} style={{ height: TRACK_H }}>
          <div className="rl-track-inner" style={{ gap: 1 }}>
            {commits.map((c) => {
              const h = 6 + (c.totalSelfTime / maxSelf) * (TRACK_H - 14);
              const color = heatColor(c.totalSelfTime);
              const active = c.commitId === frozen;
              return (
                <button
                  key={c.commitId}
                  className={`rl-bar${active ? " active" : ""}`}
                  style={{
                    width: barWidth,
                    height: h,
                    background: `rgb(${color})`,
                    opacity: active ? 1 : 0.55,
                  }}
                  title={`Commit #${c.commitId} · ${c.componentIds.length} rendered · ${ms(c.totalSelfTime)}`}
                  onClick={() => onFreeze(c.commitId === frozen ? null : c.commitId)}
                />
              );
            })}
          </div>
        </div>
      )}

      {frozenCommit && diff && (
        <div className="rl-freeze">
          <span className="rl-freeze-label">commit #{frozenCommit.commitId}</span>
          <span className="rl-freeze-stat">{frozenCommit.componentIds.length} rendered</span>
          {diff.added > 0 && <span className="rl-freeze-stat added">+{diff.added}</span>}
          {diff.gone > 0 && <span className="rl-freeze-stat gone">−{diff.gone}</span>}
          <span className="rl-freeze-stat">{ms(frozenCommit.totalSelfTime)}</span>
          <span className="rl-spacer" />
          {onReplay && (
            <button className="rl-btn rl-replay" onClick={() => onReplay(frozenCommit.componentIds)}>
              ▶ Replay wave
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

function commitDiff(prev: CommitSummary | null, cur: CommitSummary): { added: number; gone: number } {
  const prevSet = new Set(prev?.componentIds ?? []);
  const curSet = new Set(cur.componentIds);
  let added = 0;
  let gone = 0;
  for (const id of curSet) if (!prevSet.has(id)) added++;
  for (const id of prevSet) if (!curSet.has(id)) gone++;
  return { added, gone };
}
