import { useMemo, useState, useRef, useEffect } from "react";
import type { TraceStore } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { ComponentId } from "@react-lens/protocol";
import {
  buildTree,
  flatten,
  parseQuery,
  type ComponentDatum,
  type SemanticNode,
  type VisibleRow,
} from "@react-lens/tree";
import { useTraceVersion } from "./useLens.js";
import { ms } from "@react-lens/ui";

type TreeMode = "components" | "changed" | "waste";

const MODES: Array<{ id: TreeMode; label: string; hint: string }> = [
  { id: "components", label: "Components", hint: "Full ownership tree" },
  { id: "changed", label: "Changed", hint: "Rendered with observable output change" },
  { id: "waste", label: "Potential Waste", hint: "Rendered with no observable change" },
];

export function Tree({
  store,
  causality,
  selected,
  onSelect,
  onHover,
  frozen,
  doctor,
  suspended,
}: {
  store: TraceStore;
  causality: Causality;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onHover?: (id: ComponentId | null) => void;
  /** Freeze Frame: component ids that rendered in the frozen commit. */
  frozen?: Set<ComponentId>;
  /** Components with at least one Doctor diagnostic. */
  doctor?: Set<ComponentId>;
  /** Components under a currently-suspended Suspense boundary. */
  suspended?: Set<ComponentId>;
}) {
  const version = useTraceVersion(store, { kind: "global" });
  const [mode, setMode] = useState<TreeMode>("components");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Repeated-component groups (`g:*`) start collapsed so `Row ×600` shows as one
  // row until opened; component nodes start expanded (unless in `collapsed`).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const data = useMemo(
    () => buildData(store, causality, mode),
    // Recompute when the store changes or the mode switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, causality, mode, version],
  );

  const roots = useMemo(() => {
    const modeInclude = includeFor(mode);
    const queryPred = parseQuery(query);
    const include = (d: ComponentDatum) => (modeInclude ? modeInclude(d) : true) && queryPred(d);
    return buildTree(data, { include });
  }, [data, mode, query]);

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

  return (
    <div className="rl-tree" onMouseLeave={() => onHover?.(null)}>
      <div className="rl-tree-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`rl-mode${mode === m.id ? " active" : ""}`}
            title={m.hint}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <input
        className="rl-tree-search"
        placeholder="Search  renders:>20  context:X  compiled:false"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
      />

      {rows.length === 0 ? (
        <div className="rl-empty">
          {mode === "waste"
            ? "No potentially-wasted renders detected."
            : mode === "changed"
              ? "No components changed observable output yet."
              : "No components captured. Interact with the page."}
        </div>
      ) : (
        <div
          className="rl-tree-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        >
          <div className="rl-tree-rows" style={{ height: total, position: "relative" }}>
            <div style={{ position: "absolute", top: startIndex * ROW_H, left: 0, right: 0 }}>
              {windowed.map((row) => (
                <TreeRow
                  key={row.key}
                  row={row}
                  maxSelf={maxSelf}
                  selected={selected}
                  onSelect={onSelect}
                  onToggle={toggle}
                  onHover={onHover}
                  frozen={frozen}
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
  onSelect,
  onToggle,
  onHover,
  frozen,
  doctor,
  suspended,
}: {
  row: VisibleRow;
  maxSelf: number;
  selected: ComponentId | null;
  onSelect: (id: ComponentId) => void;
  onToggle: (key: string) => void;
  onHover?: (id: ComponentId | null) => void;
  frozen?: Set<ComponentId>;
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

  return (
    <div
      className={`rl-tree-row${isSelected ? " rl-selected" : ""}${frozenClass}`}
      // Cap the indent: deep real-world trees (50+ levels) would otherwise push
      // the row off-screen and collapse the name to zero width.
      style={{ paddingLeft: 6 + Math.min(depth, 14) * 8 }}
      onClick={() => {
        if (isComponent) onSelect(node.id);
        else onToggle(node.key);
      }}
      onMouseEnter={() => isComponent && onHover?.(node.id)}
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
          {inFrozen && <span className="rl-frozen-dot" title="Rendered in the frozen commit" />}
          {suspended?.has(node.id) && <span className="rl-suspense-mark" title="Suspended">◇</span>}
          {doctor?.has(node.id) && <span className="rl-doc-mark" title="Doctor issue">⚕</span>}
          {node.datum.compiled && <span className="rl-compiler" title="React Compiler optimized">◆</span>}
          {node.datum.observableChange === false && (
            <span className="rl-dot suspicious" title="No observable change" />
          )}
        </>
      ) : (
        <>
          <span className="rl-tree-name">{node.name}</span>
          <span className="rl-badge render">×{node.count}</span>
          {node.suspicious > 0 && (
            <span className="rl-badge suspicious" title="Suspicious instances">
              ⚠ {node.suspicious}
            </span>
          )}
        </>
      )}

      <span className="rl-flame">
        <span className="rl-flame-bar" style={{ width: `${(self / maxSelf) * 100}%` }} />
      </span>
      <span className="rl-tree-metric">{rowRenders(row)}×</span>
      {self > 0 && <span className="rl-tree-metric dim">{ms(self)}</span>}
    </div>
  );
}

function rowSelfTime(row: VisibleRow): number {
  return row.node.kind === "component" ? row.node.datum.selfTime : row.node.selfTime;
}
function rowRenders(row: VisibleRow): number {
  return row.node.kind === "component" ? row.node.datum.renders : row.node.renders;
}

function buildData(store: TraceStore, causality: Causality, mode: TreeMode): ComponentDatum[] {
  const needVerdict = mode !== "components";
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
      };
      void needVerdict;
      return datum;
    });
}

function verdictOf(store: TraceStore, causality: Causality, id: ComponentId): boolean | null {
  const renders = store.rendersOf(id);
  const last = renders.at(-1);
  if (!last) return null;
  try {
    const why = causality.why(last.renderId);
    if (why.verdict === "no-observable-change") return false;
    if (why.verdict === "expected") return true;
    return null;
  } catch {
    return null;
  }
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
