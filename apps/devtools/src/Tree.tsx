import { useMemo, useState, useRef, useEffect } from "react";
import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId } from "@reactlens/protocol";
import {
  buildTree,
  flatten,
  parseQuery,
  type ComponentDatum,
  type SemanticNode,
  type VisibleRow,
} from "@reactlens/tree";
import { useTraceVersion } from "./useLens.js";
import { ms } from "@reactlens/ui";
import { IconSparkle } from "@reactlens/icons";
import { SLOW_SELF_MS, componentFixPrompt } from "./perfBudget.js";

type TreeMode = "components" | "changed" | "waste";

const MODES: Array<{ id: TreeMode; label: string; compact: string; hint: string }> = [
  { id: "components", label: "Components", compact: "All", hint: "Full ownership tree" },
  { id: "changed", label: "Changed", compact: "Δ", hint: "Rendered with observable output change" },
  { id: "waste", label: "Potential Waste", compact: "Waste", hint: "Rendered with no observable change" },
];

export function Tree({
  store,
  causality,
  selected,
  onSelect,
  onHover,
  onAskAI,
  frozen,
  unrestorable,
  doctor,
  suspended,
  modeHint,
  onModeHintConsumed,
}: {
  store: TraceStore;
  causality: Causality;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onHover?: (id: ComponentId | null) => void;
  /** Inline "Fix with AI" on rows over the frame budget. */
  onAskAI?: (question: string) => void;
  /** Freeze Frame: component ids that rendered in the frozen commit. */
  frozen?: Set<ComponentId>;
  /** While traveling: components whose state could not be restored. */
  unrestorable?: Set<ComponentId>;
  /** Components with at least one Doctor diagnostic. */
  doctor?: Set<ComponentId>;
  /** Components under a currently-suspended Suspense boundary. */
  suspended?: Set<ComponentId>;
  /** External request to switch mode (e.g. waste banner → Potential Waste). */
  modeHint?: TreeMode | null;
  onModeHintConsumed?: () => void;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [mode, setMode] = useState<TreeMode>("components");
  useEffect(() => {
    if (!modeHint) return;
    setMode(modeHint);
    onModeHintConsumed?.();
  }, [modeHint, onModeHintConsumed]);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Repeated-component groups (`g:*`) start collapsed so `Row ×600` shows as one
  // row until opened; component nodes start expanded (unless in `collapsed`).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const data = useMemo(
    () => buildData(store, causality),
    // Recompute when the store ingests (version); verdicts are memoized per
    // last render inside verdictOf, so steady components stay cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, causality, version],
  );

  const parsed = useMemo(() => parseQuery(query), [query]);
  const roots = useMemo(() => {
    const modeInclude = includeFor(mode);
    const include = (d: ComponentDatum) =>
      (modeInclude ? modeInclude(d) : true) && parsed.predicate(d);
    return buildTree(data, { include });
  }, [data, mode, parsed]);
  /** Match count for the filter affordance (query only, mode-independent). */
  const matchCount = useMemo(
    () => (query.trim() ? data.filter(parsed.predicate).length : null),
    [data, parsed, query],
  );

  const allKeys = useMemo(() => collectKeys(roots), [roots]);
  const expanded = useMemo(() => {
    const set = new Set<string>();
    for (const key of allKeys) {
      if (key.startsWith("g:")) {
        if (openGroups.has(key)) set.add(key);
      } else if (!collapsed.has(key)) {
        set.add(key);
      }
    }
    return set;
  }, [allKeys, collapsed, openGroups]);

  const rows = useMemo(() => flatten(roots, expanded), [roots, expanded]);
  const maxSelf = useMemo(() => Math.max(1, ...rows.map((r) => rowSelfTime(r))), [rows]);
  // Rows under the selected foldable component — tinted so the subtree reads as one group.
  const inSelection = useMemo(() => descendantKeys(roots, selected), [roots, selected]);

  // Row windowing: only mount rows in (or near) the viewport, so a 10k-node
  // tree still renders ~30-100 rows. Row height is fixed (ROW_H).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setViewport(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ROW_H = 26;
  const OVERSCAN = 8;
  const total = rows.length * ROW_H;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
  const windowed = rows.slice(startIndex, endIndex);

  const toggle = (key: string) => {
    const setter = key.startsWith("g:") ? setOpenGroups : setCollapsed;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Keyboard navigation: ↑↓ move (components select as they focus, like
  // Linear), →/← expand/collapse or jump to parent, Enter acts on the row.
  const [focusIdx, setFocusIdx] = useState(0);
  const clampedFocus = Math.min(focusIdx, Math.max(0, rows.length - 1));
  const focusRow = (idx: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, idx));
    setFocusIdx(next);
    const row = rows[next];
    if (row && row.node.kind === "component") onSelect(row.node.id);
    // Keep the focused row inside the scrollport.
    const el = scrollRef.current;
    if (el) {
      const top = next * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight)
        el.scrollTop = top + ROW_H - el.clientHeight;
    }
  };
  const onTreeKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[clampedFocus];
    if (!row) return;
    if (e.key === "ArrowDown") focusRow(clampedFocus + 1);
    else if (e.key === "ArrowUp") focusRow(clampedFocus - 1);
    else if (e.key === "ArrowRight") {
      if (row.expandable && !row.expanded) toggle(row.node.key);
      else focusRow(clampedFocus + 1);
    } else if (e.key === "ArrowLeft") {
      if (row.expandable && row.expanded) toggle(row.node.key);
      else {
        // Jump to the parent: the nearest earlier row one level up.
        for (let i = clampedFocus - 1; i >= 0; i--) {
          if (rows[i]!.depth < row.depth) {
            focusRow(i);
            break;
          }
        }
      }
    } else if (e.key === "Enter") {
      if (row.node.kind === "component") onSelect(row.node.id);
      else toggle(row.node.key);
    } else {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="rl-tree" onMouseLeave={() => onHover?.(null)}>
      <div className="rl-tree-modes">
        <div className="rl-seg" role="tablist" aria-label="Tree mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`rl-mode${mode === m.id ? " active" : ""}`}
              title={m.hint}
              onClick={() => setMode(m.id)}
            >
              <span className="rl-mode-full">{m.label}</span>
              <span className="rl-mode-compact">{m.compact}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rl-tree-search-wrap">
        <input
          className={`rl-tree-search${parsed.errors.length > 0 ? " invalid" : ""}`}
          placeholder="Filter by name, /regex/, renders:>5…"
          value={query}
          spellCheck={false}
          aria-invalid={parsed.errors.length > 0}
          {...(parsed.errors.length > 0 ? { title: parsed.errors.join(" · ") } : {})}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matchCount !== null && parsed.errors.length === 0 && (
          <span className="rl-tree-search-count">{matchCount}</span>
        )}
        {parsed.errors.length > 0 && <span className="rl-tree-search-count invalid">!</span>}
      </div>

      {rows.length === 0 ? (
        <div className="rl-empty rl-empty-action">
          <span>
            {mode === "waste"
              ? "No potentially wasted renders."
              : mode === "changed"
                ? "No observable output changes yet."
                : "No components yet."}
          </span>
          <span className="rl-empty-hint">
            {mode === "components" ? "Interact with the page to capture a tree." : "Try another mode or clear the filter."}
          </span>
        </div>
      ) : (
        <div
          className="rl-tree-scroll"
          ref={scrollRef}
          tabIndex={0}
          role="tree"
          aria-label="Component tree"
          onKeyDown={onTreeKeyDown}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div className="rl-tree-rows" style={{ height: total, position: "relative" }}>
            <div style={{ position: "absolute", top: startIndex * ROW_H, left: 0, right: 0 }}>
              {windowed.map((row, i) => (
                <TreeRow
                  key={row.key}
                  row={row}
                  maxSelf={maxSelf}
                  selected={selected}
                  inSelection={inSelection.has(row.key)}
                  kbFocused={startIndex + i === clampedFocus}
                  onSelect={onSelect}
                  onFocusRow={() => setFocusIdx(startIndex + i)}
                  onToggle={toggle}
                  onHover={onHover}
                  {...(onAskAI ? { onAskAI } : {})}
                  frozen={frozen}
                  unrestorable={unrestorable}
                  doctor={doctor}
                  suspended={suspended}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TreeRow({
  row,
  maxSelf,
  selected,
  inSelection,
  kbFocused,
  onSelect,
  onFocusRow,
  onToggle,
  onHover,
  onAskAI,
  frozen,
  unrestorable,
  doctor,
  suspended,
}: {
  row: VisibleRow;
  maxSelf: number;
  selected: ComponentId | null;
  inSelection: boolean;
  kbFocused?: boolean;
  onSelect: (id: ComponentId) => void;
  onFocusRow?: () => void;
  onToggle: (key: string) => void;
  onHover?: (id: ComponentId | null) => void;
  onAskAI?: (question: string) => void;
  frozen?: Set<ComponentId>;
  unrestorable?: Set<ComponentId>;
  doctor?: Set<ComponentId>;
  suspended?: Set<ComponentId>;
}) {
  const { node, depth, expandable, expanded } = row;
  const self = rowSelfTime(row);
  const isComponent = node.kind === "component";
  const isSelected = isComponent && node.id === selected;
  // Freeze Frame: did this row render in the frozen commit?
  const inFrozen = frozen && isComponent ? frozen.has(node.id) : undefined;
  const frozenClass = inFrozen === false ? " rl-frozen-out" : "";
  const selClass = isSelected ? " rl-selected" : inSelection ? " rl-in-selection" : "";
  const kbClass = kbFocused ? " rl-kb-focus" : "";

  return (
    <div
      className={`rl-tree-row${selClass}${frozenClass}${kbClass}`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={() => {
        onFocusRow?.();
        if (isComponent) onSelect(node.id);
        else onToggle(node.key);
      }}
      onMouseEnter={() => isComponent && onHover?.(node.id)}
    >
      {/* Indent lives in the left cluster so flame + metrics stay column-aligned. */}
      <div
        className="rl-tree-main"
        style={{ paddingLeft: 6 + Math.min(depth, 14) * 8 }}
      >
        <span
          className={`rl-caret${expandable ? "" : " hidden"}`}
          onClick={(e) => {
            if (!expandable) return;
            e.stopPropagation();
            onToggle(node.key);
          }}
        >
          {expandable ? (expanded ? "▾" : "▸") : ""}
        </span>

        {node.kind === "component" ? (
          <>
            <span className="rl-tree-name">{node.datum.name}</span>
            <TreePips
              frozen={!!inFrozen}
              norewind={!!unrestorable?.has(node.id)}
              server={node.datum.kind === "server-boundary"}
              suspended={!!suspended?.has(node.id)}
              doctor={!!doctor?.has(node.id)}
              compiled={!!node.datum.compiled}
              waste={node.datum.observableChange === false}
            />
          </>
        ) : (
          <>
            <span className="rl-tree-name">{node.name}</span>
            <span className="rl-badge render">×{node.count}</span>
            {node.suspicious > 0 && (
              <span className="rl-pip warn" title={`${node.suspicious} suspicious`}>
                {node.suspicious}
              </span>
            )}
          </>
        )}
      </div>

      {node.kind === "component" && onAskAI && self >= SLOW_SELF_MS && (
        <span
          role="button"
          tabIndex={0}
          className="rl-fix-ai"
          title={`Over the frame budget (${ms(self)} self) — investigate and fix with AI`}
          onClick={(e) => {
            e.stopPropagation();
            onAskAI(componentFixPrompt(node.datum.name, node.id as number, self, rowRenders(row)));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            onAskAI(componentFixPrompt(node.datum.name, node.id as number, self, rowRenders(row)));
          }}
        >
          <IconSparkle size={11} />
        </span>
      )}
      <span
        className="rl-tree-stats"
        title={`${rowRenders(row)}×${self > 0 ? ` · ${ms(self)}` : ""}`}
      >
        <span className="rl-flame" aria-hidden>
          <span className="rl-flame-bar" style={{ width: `${(self / maxSelf) * 100}%` }} />
        </span>
        <span className="rl-tree-metric rl-tree-renders">{rowRenders(row)}×</span>
        <span className="rl-tree-metric rl-tree-ms dim">{self > 0 ? ms(self) : ""}</span>
        <span className="rl-tree-stats-compact">
          {rowRenders(row)}×{self > 0 ? ` · ${ms(self)}` : ""}
        </span>
      </span>
    </div>
  );
}

function TreePips({
  frozen,
  norewind,
  server,
  suspended,
  doctor,
  compiled,
  waste,
}: {
  frozen: boolean;
  /** Time travel could not restore this component's state at the playhead. */
  norewind: boolean;
  server: boolean;
  suspended: boolean;
  doctor: boolean;
  compiled: boolean;
  waste: boolean;
}) {
  // One severity pip max (doctor > waste > suspended), plus quiet meta marks.
  const severity = doctor ? "doctor" : waste ? "waste" : suspended ? "suspended" : null;
  const title =
    severity === "doctor"
      ? "Doctor issue"
      : severity === "waste"
        ? "No observable change"
        : severity === "suspended"
          ? "Suspended"
          : undefined;
  return (
    <span className="rl-tree-pips">
      {frozen && <span className="rl-pip frozen" title="In frozen commit" />}
      {norewind && (
        <span className="rl-pip norewind" title="State couldn't be rewound at this playhead" />
      )}
      {severity && <span className={`rl-pip ${severity}`} title={title} />}
      {server && <span className="rl-pip server" title="RSC / Flight" />}
      {compiled && !severity && <span className="rl-pip compiled" title="Compiler optimized" />}
    </span>
  );
}

function rowSelfTime(row: VisibleRow): number {
  return row.node.kind === "component" ? row.node.datum.selfTime : row.node.selfTime;
}
function rowRenders(row: VisibleRow): number {
  return row.node.kind === "component" ? row.node.datum.renders : row.node.renders;
}

function buildData(store: TraceStore, causality: Causality): ComponentDatum[] {
  return store
    .allInstances()
    .filter((i) => store.renderCount(i.id) > 0)
    .map((i) => {
      const datum: ComponentDatum = {
        id: i.id,
        name: i.name,
        renders: store.renderCount(i.id),
        selfTime: store.selfTimeTotal(i.id),
        compiled: i.compiler.compiled,
        observableChange: verdictOf(store, causality, i.id),
        ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
        ...(i.kind && i.kind !== "component" ? { kind: i.kind } : {}),
      };
      return datum;
    });
}

/**
 * A verdict only depends on a component's LAST render, but buildData runs on
 * every store version bump — memoize per (causality, component, renderId) so
 * steady components cost a map lookup instead of a causality walk.
 */
const verdictCache = new WeakMap<
  Causality,
  Map<ComponentId, { renderId: number; verdict: boolean | null }>
>();

function verdictOf(store: TraceStore, causality: Causality, id: ComponentId): boolean | null {
  const renders = store.rendersOf(id);
  const last = renders.at(-1);
  if (!last) return null;
  let byId = verdictCache.get(causality);
  if (!byId) {
    byId = new Map();
    verdictCache.set(causality, byId);
  }
  const hit = byId.get(id);
  if (hit && hit.renderId === last.renderId) return hit.verdict;
  let verdict: boolean | null;
  try {
    const why = causality.why(last.renderId);
    verdict =
      why.verdict === "no-observable-change" ? false : why.verdict === "expected" ? true : null;
  } catch {
    verdict = null;
  }
  byId.set(id, { renderId: last.renderId, verdict });
  return verdict;
}

function includeFor(mode: TreeMode): ((d: ComponentDatum) => boolean) | undefined {
  if (mode === "changed") return (d) => d.observableChange === true;
  if (mode === "waste") return (d) => d.observableChange === false;
  return undefined;
}

function collectKeys(roots: SemanticNode[]): string[] {
  const keys: string[] = [];
  const walk = (nodes: SemanticNode[]) => {
    for (const node of nodes) {
      keys.push(node.key);
      if (node.kind === "component") walk(node.children);
      else walk(node.instances);
    }
  };
  walk(roots);
  return keys;
}

/** Keys of every node under the selected component (not including itself). */
function descendantKeys(roots: SemanticNode[], selected: ComponentId | null): Set<string> {
  const empty = new Set<string>();
  if (selected === null) return empty;
  const out = new Set<string>();
  const mark = (nodes: SemanticNode[]) => {
    for (const node of nodes) {
      out.add(node.key);
      if (node.kind === "component") mark(node.children);
      else mark(node.instances);
    }
  };
  const find = (nodes: SemanticNode[]): boolean => {
    for (const node of nodes) {
      if (node.kind === "component" && node.id === selected) {
        mark(node.children);
        return true;
      }
      const kids = node.kind === "component" ? node.children : node.instances;
      if (find(kids)) return true;
    }
    return false;
  };
  find(roots);
  return out;
}
