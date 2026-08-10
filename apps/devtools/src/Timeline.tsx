import { useMemo, useRef, useState, useEffect } from "react";
import type { TraceStore, CommitSummary } from "@react-lens/trace-engine";
import type { ComponentId, CommitId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "./format.js";

const MIN_BAR = 4;
const MAX_BAR = 28;
const TRACK_H = 56;

function heatColor(msVal: number): string {
  if (msVal < 1) return "74,222,128";
  if (msVal < 5) return "251,191,36";
  if (msVal < 16) return "251,146,60";
  return "248,113,113";
}

interface MenuState {
  x: number;
  y: number;
  commitId: CommitId;
}

/**
 * Commit timeline. Zoomable/pannable bar track. Click a bar to freeze it
 * (Freeze Frame + Tree Diff); drag across bars to select a range; right-click
 * for actions. Replay animates the selected commits' update wave on the page.
 */
export function Timeline({
  store,
  onFreeze,
  onReplay,
}: {
  store: TraceStore;
  onFreeze: (id: CommitId | null) => void;
  onReplay?: (ids: ComponentId[]) => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const allCommits = useMemo(() => store.commits(), [store, version]);
  const [barWidth, setBarWidth] = useState(8);
  const [selected, setSelected] = useState<Set<CommitId>>(new Set());
  const [ignored, setIgnored] = useState<Set<CommitId>>(new Set());
  const [deleted, setDeleted] = useState<Set<CommitId>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number } | null>(null);

  const commits = useMemo(
    () => allCommits.filter((c) => !deleted.has(c.commitId)),
    [allCommits, deleted],
  );
  const maxSelf = useMemo(() => Math.max(1, ...commits.map((c) => c.totalSelfTime)), [commits]);

  // Sync single-selection to the freeze-frame (tree marking is single-commit).
  useEffect(() => {
    if (selected.size === 1) onFreeze([...selected][0]!);
    else onFreeze(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // End a drag anywhere; close the context menu on any outside interaction.
  useEffect(() => {
    const up = () => (drag.current = null);
    const close = () => setMenu(null);
    window.addEventListener("mouseup", up);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("mousedown", close);
    };
  }, []);

  const selectRange = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    setSelected(new Set(commits.slice(lo, hi + 1).map((c) => c.commitId)));
  };

  const zoom = (d: number) => setBarWidth((w) => Math.max(MIN_BAR, Math.min(MAX_BAR, w + d)));

  const onWheel = (e: React.WheelEvent) => {
    const el = trackRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 2 : -2);
    else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
  };

  const replayIds = (): ComponentId[] => {
    const ids: ComponentId[] = [];
    for (const c of commits) {
      if (!selected.has(c.commitId) || ignored.has(c.commitId)) continue;
      ids.push(...c.componentIds);
    }
    return ids;
  };

  const selectedCommits = commits.filter((c) => selected.has(c.commitId));
  const single = selectedCommits.length === 1 ? selectedCommits[0]! : null;
  const prevOfSingle = single ? commits[commits.indexOf(single) - 1] ?? null : null;
  const diff = single ? commitDiff(prevOfSingle, single) : null;

  return (
    <div className="rl-timeline-wrap">
      <div className="rl-timeline-head">
        <span className="rl-timeline-title">Timeline</span>
        <span className="rl-timeline-sub">
          {commits.length} commits{selected.size > 1 ? ` · ${selected.size} selected` : ""}
        </span>
        <span className="rl-spacer" />
        <div className="rl-zoom">
          <button className="rl-zoom-btn" onClick={() => zoom(-4)} aria-label="Zoom out">−</button>
          <button className="rl-zoom-btn" onClick={() => zoom(4)} aria-label="Zoom in">+</button>
        </div>
      </div>

      {commits.length === 0 ? (
        <div className="rl-timeline-empty">No commits yet — interact with the page.</div>
      ) : (
        <div className="rl-track" ref={trackRef} onWheel={onWheel} style={{ height: TRACK_H }}>
          <div className="rl-track-inner">
            {commits.map((c, i) => (
              <button
                key={c.commitId}
                className={
                  "rl-bar" +
                  (selected.has(c.commitId) ? " active" : "") +
                  (ignored.has(c.commitId) ? " ignored" : "")
                }
                style={{
                  width: barWidth,
                  height: 6 + (c.totalSelfTime / maxSelf) * (TRACK_H - 14),
                  background: `rgb(${heatColor(c.totalSelfTime)})`,
                }}
                title={`Commit #${c.commitId} · ${c.componentIds.length} rendered · ${ms(c.totalSelfTime)}`}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  drag.current = { start: i };
                  selectRange(i, i);
                }}
                onMouseEnter={() => {
                  if (drag.current) selectRange(drag.current.start, i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selected.has(c.commitId)) selectRange(i, i);
                  setMenu({ x: e.clientX, y: e.clientY, commitId: c.commitId });
                }}
              />
            ))}
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="rl-freeze">
          {single && diff ? (
            <>
              <span className="rl-freeze-label">commit #{single.commitId}</span>
              <span className="rl-freeze-stat">{single.componentIds.length} rendered</span>
              {diff.added > 0 && <span className="rl-freeze-stat added">+{diff.added}</span>}
              {diff.gone > 0 && <span className="rl-freeze-stat gone">−{diff.gone}</span>}
              <span className="rl-freeze-stat">{ms(single.totalSelfTime)}</span>
            </>
          ) : (
            <span className="rl-freeze-label">{selected.size} commits selected</span>
          )}
          <span className="rl-spacer" />
          {onReplay && (
            <button className="rl-ctl rl-ctl-primary" onClick={() => onReplay(replayIds())}>
              ▶ Replay{selected.size > 1 ? ` ${selected.size}` : ""}
            </button>
          )}
          <button className="rl-ctl" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            ✕
          </button>
        </div>
      )}

      {menu && (
        <CommitMenu
          menu={menu}
          count={selected.size}
          ignored={ignored.has(menu.commitId)}
          onReplay={onReplay ? () => onReplay(replayIds()) : undefined}
          onIgnore={() =>
            setIgnored((prev) => toggle(prev, [...selected].length ? [...selected] : [menu.commitId]))
          }
          onDelete={() => {
            setDeleted((prev) => add(prev, [...selected].length ? [...selected] : [menu.commitId]));
            setSelected(new Set());
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function CommitMenu({
  menu,
  count,
  ignored,
  onReplay,
  onIgnore,
  onDelete,
  onClose,
}: {
  menu: MenuState;
  count: number;
  ignored: boolean;
  onReplay?: () => void;
  onIgnore: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const noun = count > 1 ? `${count} commits` : `commit #${menu.commitId}`;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  // The timeline sits at the bottom, so flip the menu upward near the edge.
  const flipUp = typeof window !== "undefined" && menu.y > window.innerHeight - 160;
  const style = flipUp
    ? { left: menu.x, bottom: window.innerHeight - menu.y }
    : { left: menu.x, top: menu.y };
  return (
    <div className="rl-menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="rl-menu-head">{noun}</div>
      {onReplay && (
        <button className="rl-menu-item" onClick={run(onReplay)}>
          ▶ Replay
        </button>
      )}
      <button className="rl-menu-item" onClick={run(onIgnore)}>
        {ignored ? "Un-ignore" : "Ignore"}
      </button>
      <button className="rl-menu-item danger" onClick={run(onDelete)}>
        Delete
      </button>
    </div>
  );
}

function toggle(set: Set<CommitId>, ids: CommitId[]): Set<CommitId> {
  const next = new Set(set);
  const allIgnored = ids.every((id) => next.has(id));
  for (const id of ids) (allIgnored ? next.delete(id) : next.add(id));
  return next;
}
function add(set: Set<CommitId>, ids: CommitId[]): Set<CommitId> {
  const next = new Set(set);
  for (const id of ids) next.add(id);
  return next;
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
