import { useMemo, useRef, useState, useEffect } from "react";
import type { TraceStore, CommitSummary } from "@react-lens/trace-engine";
import type { ComponentId, CommitId } from "@react-lens/protocol";
import { useTraceVersion } from "./useLens.js";
import { ms } from "@react-lens/ui";

const MIN_BAR = 5;
const MAX_BAR = 30;
const GAP = 2;
const TRACK_H = 60;

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
 * Commit timeline. A zoomable, pannable bar track. Pointer hit-testing (not
 * per-bar handlers) drives selection: click to select, drag for a range,
 * shift-click to extend, ⌘/ctrl-click to toggle. Right-click for actions.
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
  const [barWidth, setBarWidth] = useState(9);
  const [selected, setSelected] = useState<Set<CommitId>>(new Set());
  const [ignored, setIgnored] = useState<Set<CommitId>>(new Set());
  const [deleted, setDeleted] = useState<Set<CommitId>>(new Set());
  const [hovered, setHovered] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number } | null>(null);
  const anchor = useRef<number>(0);

  const commits = useMemo(
    () => allCommits.filter((c) => !deleted.has(c.commitId)),
    [allCommits, deleted],
  );
  const maxSelf = useMemo(() => Math.max(1, ...commits.map((c) => c.totalSelfTime)), [commits]);

  useEffect(() => {
    if (selected.size === 1) onFreeze([...selected][0]!);
    else onFreeze(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    const up = () => (drag.current = null);
    const close = () => setMenu(null);
    window.addEventListener("pointerup", up);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("mousedown", close);
    };
  }, []);

  const step = barWidth + GAP;

  /** Which bar index is under a client X coordinate. */
  const indexAt = (clientX: number): number => {
    const inner = innerRef.current;
    if (!inner) return 0;
    const x = clientX - inner.getBoundingClientRect().left;
    return Math.max(0, Math.min(commits.length - 1, Math.floor(x / step)));
  };

  const selectRange = (a: number, b: number) =>
    setSelected(new Set(commits.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.commitId)));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || commits.length === 0) return;
    const i = indexAt(e.clientX);
    const id = commits[i]!.commitId;
    if (e.shiftKey) {
      selectRange(anchor.current, i);
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      anchor.current = i;
    } else {
      drag.current = { start: i };
      anchor.current = i;
      selectRange(i, i);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (commits.length === 0) return;
    const i = indexAt(e.clientX);
    setHovered(i);
    if (drag.current) selectRange(drag.current.start, i);
  };

  const zoom = (d: number) => setBarWidth((w) => Math.max(MIN_BAR, Math.min(MAX_BAR, w + d)));
  const pan = (dir: 1 | -1) => scrollRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" });

  const onWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 2 : -2);
    else el.scrollLeft += e.deltaX || e.deltaY; // horizontal or vertical → pan
  };

  const replayIds = (): ComponentId[] => {
    const ids: ComponentId[] = [];
    for (const c of commits) {
      if (selected.has(c.commitId) && !ignored.has(c.commitId)) ids.push(...c.componentIds);
    }
    return ids;
  };

  const selectedCommits = commits.filter((c) => selected.has(c.commitId));
  const single = selectedCommits.length === 1 ? selectedCommits[0]! : null;
  const prevOfSingle = single ? commits[commits.indexOf(single) - 1] ?? null : null;
  const diff = single ? commitDiff(prevOfSingle, single) : null;
  const hoveredCommit = hovered !== null ? commits[hovered] : undefined;

  return (
    <div className="rl-timeline-wrap">
      <div className="rl-timeline-head">
        <span className="rl-timeline-title">Timeline</span>
        <span className="rl-timeline-sub">
          {commits.length} commits{selected.size > 1 ? ` · ${selected.size} selected` : ""}
        </span>
        <span className="rl-spacer" />
        <div className="rl-zoom">
          <button className="rl-zoom-btn" onClick={() => pan(-1)} aria-label="Pan left">‹</button>
          <button className="rl-zoom-btn" onClick={() => pan(1)} aria-label="Pan right">›</button>
          <span className="rl-zoom-sep" />
          <button className="rl-zoom-btn" onClick={() => zoom(-4)} aria-label="Zoom out">−</button>
          <button className="rl-zoom-btn" onClick={() => zoom(4)} aria-label="Zoom in">+</button>
        </div>
      </div>

      {commits.length === 0 ? (
        <div className="rl-timeline-empty">No commits yet — interact with the page.</div>
      ) : (
        <div className="rl-track" ref={scrollRef} onWheel={onWheel} style={{ height: TRACK_H }}>
          <div
            className="rl-track-inner"
            ref={innerRef}
            style={{ gap: GAP }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHovered(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              const i = indexAt(e.clientX);
              const id = commits[i]!.commitId;
              if (!selected.has(id)) selectRange(i, i);
              setMenu({ x: e.clientX, y: e.clientY, commitId: id });
            }}
          >
            {commits.map((c, i) => {
              const h = 4 + (c.totalSelfTime / maxSelf) * (TRACK_H - 16);
              const cls =
                "rl-bar" +
                (selected.has(c.commitId) ? " active" : "") +
                (ignored.has(c.commitId) ? " ignored" : "") +
                (hovered === i ? " hover" : "");
              return (
                <span
                  key={c.commitId}
                  className={cls}
                  style={{ width: barWidth, height: h, background: `rgb(${heatColor(c.totalSelfTime)})` }}
                />
              );
            })}
          </div>
          {hoveredCommit && (
            <div className="rl-tip" style={{ left: hovered! * step - (scrollRef.current?.scrollLeft ?? 0) }}>
              #{hoveredCommit.commitId} · {hoveredCommit.componentIds.length} · {ms(hoveredCommit.totalSelfTime)}
            </div>
          )}
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
          onIgnore={() => setIgnored((prev) => toggle(prev, [...selected]))}
          onDelete={() => {
            setDeleted((prev) => add(prev, [...selected]));
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
  const flipUp = typeof window !== "undefined" && menu.y > window.innerHeight - 160;
  const style = flipUp
    ? { left: menu.x, bottom: window.innerHeight - menu.y }
    : { left: menu.x, top: menu.y };
  return (
    <div className="rl-menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <div className="rl-menu-head">{noun}</div>
      {onReplay && (
        <button className="rl-menu-item" onClick={run(onReplay)}>▶ Replay</button>
      )}
      <button className="rl-menu-item" onClick={run(onIgnore)}>{ignored ? "Un-ignore" : "Ignore"}</button>
      <button className="rl-menu-item danger" onClick={run(onDelete)}>Delete</button>
    </div>
  );
}

function toggle(set: Set<CommitId>, ids: CommitId[]): Set<CommitId> {
  const next = new Set(set);
  const allIgnored = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) allIgnored ? next.delete(id) : next.add(id);
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
