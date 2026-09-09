/**
 * Lens 1 — Ledger.
 *
 * Depth becomes indentation, so the cascade reads top-to-bottom in reading
 * order. Rows are a fixed height, which is what lets the list window: only the
 * visible slice is ever in the DOM, so 609 renders cost the same as 33.
 */

import { chainOf } from "./data.js";
import {
  getProjection,
  getState,
  hover,
  select,
  toggleCollapsed,
  toggleGroup,
  update,
} from "./store.js";

const ROW_H = 26;
const OVERSCAN = 8;
/** Consecutive same-name siblings at or above this count fold into one row. */
const FOLD_AT = 3;

/**
 * Siblings fold only when their entire subtree is identical, so folding never
 * hides structure — just repetition.
 */
function groupKey(node) {
  return `${node.parentId ?? "root"}|${node.shape}`;
}

/** Consecutive siblings sharing name+cause collapse into one `×N` row. */
function groupSiblings(children, state) {
  if (!state.foldRepeats) return children.map((node) => ({ kind: "node", node }));
  const runs = [];
  for (const node of children) {
    const key = groupKey(node);
    const prev = runs[runs.length - 1];
    if (prev && prev.key === key) prev.members.push(node);
    else runs.push({ key, members: [node] });
  }
  return runs.flatMap((run) =>
    run.members.length >= FOLD_AT && !state.expandedGroups.has(run.key)
      ? [{ kind: "group", node: run.members[0], members: run.members, key: run.key }]
      : run.members.map((node) => ({ kind: "node", node })),
  );
}

function buildMatcher(query) {
  if (!query) return null;
  const needle = query.toLowerCase();
  const cache = new Map();
  const hits = (node) => {
    const cached = cache.get(node.id);
    if (cached !== undefined) return cached;
    const value = node.name.toLowerCase().includes(needle) || node.children.some((c) => hits(c));
    cache.set(node.id, value);
    return value;
  };
  return { needle, hits, self: (node) => node.name.toLowerCase().includes(needle) };
}

/** Flatten the tree into the exact list of rows the viewport can show. */
export function flattenRows(projection, state) {
  const matcher = buildMatcher(state.query);
  // A filter is a request to see the hits; honouring stale collapse would hide them.
  const filtering = matcher !== null;
  const rows = [];

  const walk = (entry, depth) => {
    const node = entry.node;
    if (matcher && !matcher.hits(node)) return;
    rows.push({ ...entry, depth, muted: matcher !== null && !matcher.self(node) });
    if (entry.kind === "group") return;
    if (!filtering && state.collapsed.has(node.id)) return;
    for (const child of groupSiblings(node.children, state)) walk(child, depth + 1);
  };

  for (const root of projection.roots) walk({ kind: "node", node: root }, 0);
  return rows;
}

function sum(members, key) {
  return members.reduce((total, node) => total + node[key], 0);
}

export function mount(container) {
  container.innerHTML = `
    <div class="pane">
      <div class="toolbar">
        <label class="search">
          <input id="ledger-filter" type="search" placeholder="Filter components — ancestors are kept"
                 aria-label="Filter components" />
          <kbd class="slash">/</kbd>
        </label>
        <label class="check"><input type="checkbox" id="fold-repeats" checked /> Fold repeats</label>
        <button class="icon-btn" id="collapse-all" title="Collapse every subtree">Collapse all</button>
      </div>
      <div class="scroller" id="ledger-scroller" tabindex="0" role="tree" aria-label="Render cascade">
        <div class="spacer" id="ledger-spacer"><div class="rows" id="ledger-rows"></div></div>
      </div>
    </div>`;

  const scroller = container.querySelector("#ledger-scroller");
  const spacer = container.querySelector("#ledger-spacer");
  const rowsEl = container.querySelector("#ledger-rows");
  const filterEl = container.querySelector("#ledger-filter");
  const foldEl = container.querySelector("#fold-repeats");

  let rows = [];
  let pendingScrollTo = null;
  /** Only chase the selection when it actually moved — never while hovering. */
  let lastSelectedId = null;

  filterEl.addEventListener("input", () => update({ query: filterEl.value.trim() }));
  foldEl.addEventListener("change", () => update({ foldRepeats: foldEl.checked }));
  const collapseEl = container.querySelector("#collapse-all");
  collapseEl.addEventListener("click", () => {
    if (getState().collapsed.size > 0) return update({ collapsed: new Set() });
    const projection = getProjection();
    update({
      collapsed: new Set(
        projection.nodes
          .filter((n) => n.children.length > 0 && n.parentId != null)
          .map((n) => n.id),
      ),
    });
  });

  scroller.addEventListener("scroll", paint, { passive: true });
  scroller.addEventListener("mouseleave", () => hover(null));

  scroller.addEventListener("keydown", (event) => {
    const state = getState();
    const index = rows.findIndex((r) => r.kind === "node" && r.node.id === state.selectedId);
    const step = (delta) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
      if (!next) return;
      event.preventDefault();
      pendingScrollTo = next.node.id;
      if (next.kind === "group") toggleGroup(next.key);
      else select(next.node.id);
    };
    switch (event.key) {
      case "ArrowDown":
        return step(1);
      case "ArrowUp":
        return step(-1);
      case "Home":
        event.preventDefault();
        return select(rows[0]?.node.id ?? null);
      case "End":
        event.preventDefault();
        return select(rows[rows.length - 1]?.node.id ?? null);
      case "ArrowRight": {
        const node = getProjection().byId.get(state.selectedId);
        if (!node) return;
        event.preventDefault();
        if (node.children.length > 0 && state.collapsed.has(node.id)) toggleCollapsed(node.id);
        else if (node.children.length > 0) select(node.children[0].id);
        return;
      }
      case "ArrowLeft": {
        const node = getProjection().byId.get(state.selectedId);
        if (!node) return;
        event.preventDefault();
        if (node.children.length > 0 && !state.collapsed.has(node.id)) toggleCollapsed(node.id);
        else if (node.parentId != null) {
          pendingScrollTo = node.parentId;
          select(node.parentId);
        }
        return;
      }
      default:
        break;
    }
  });

  function rowHtml(row, projection, focusChain) {
    const node = row.node;
    const isGroup = row.kind === "group";
    const members = isGroup ? row.members : [node];
    const self = sum(members, "selfDuration");
    const subtree = isGroup ? sum(members, "totalDuration") : node.totalDuration;
    const count = isGroup ? sum(members, "subtreeCount") : node.subtreeCount;
    const state = getState();
    const collapsed = state.collapsed.has(node.id);
    const hasChildren = !isGroup && node.children.length > 0;
    const scale = projection.maxTotal || 1;
    const pct = (value) => `${Math.max(value > 0 ? 1.5 : 0, (value / scale) * 100)}%`;
    const label = state.query
      ? node.name.replace(
          new RegExp(`(${state.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"),
          "<mark>$1</mark>",
        )
      : node.name;

    return (
      `<div class="row" role="treeitem" aria-level="${row.depth + 1}"` +
      ` aria-expanded="${hasChildren ? String(!collapsed) : ""}"` +
      ` data-id="${node.id}" data-group="${isGroup ? row.key : ""}"` +
      ` data-selected="${!isGroup && node.id === state.selectedId}"` +
      ` data-kin="${!isGroup && node.id !== state.selectedId && focusChain.has(node.id)}"` +
      ` data-muted="${row.muted}"` +
      ` style="transform:translateY(${row.index * ROW_H}px);position:absolute;left:0;right:0">` +
      `<span class="ord">${node.order + 1}</span>` +
      `<span class="name">` +
      '<span class="guide"></span>'.repeat(row.depth) +
      `<span class="twist" data-twist="${hasChildren || isGroup ? "1" : ""}">${
        hasChildren || isGroup ? "▶" : ""
      }</span>` +
      `<span class="dot cause-${node.cause}"></span>` +
      `<span class="nm">${label}</span>` +
      (isGroup ? `<span class="mult">×${members.length}</span>` : "") +
      `</span>` +
      (isGroup
        ? `<span class="pill">${count} renders</span>`
        : hasChildren && collapsed
          ? `<span class="pill">+${node.subtreeCount - 1}</span>`
          : "<span></span>") +
      `<span class="bar" title="self ${self.toFixed(2)} ms · subtree ${subtree.toFixed(2)} ms">` +
      `<i class="subtree cause-${node.cause}" style="width:${pct(subtree)}"></i>` +
      `<i class="self cause-${node.cause}" style="width:${pct(self)}"></i>` +
      `</span>` +
      `<span class="ms" data-hot="${self / projection.totalSelf > 0.15}">${self.toFixed(2)}</span>` +
      `</div>`
    );
  }

  function paint() {
    const projection = getProjection();
    const state = getState();
    const focused = state.hoverId ?? state.selectedId;
    const focusChain = new Set(focused ? chainOf(projection, focused).map((n) => n.id) : []);

    if (rows.length === 0) {
      rowsEl.innerHTML = `<div class="empty">No component matches “${state.query}”.</div>`;
      rowsEl.style.transform = "none";
      return;
    }

    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_H) - OVERSCAN);
    const visible = Math.ceil(scroller.clientHeight / ROW_H) + OVERSCAN * 2;
    const slice = rows.slice(first, first + visible);
    rowsEl.innerHTML = slice.map((row) => rowHtml(row, projection, focusChain)).join("");
  }

  function scrollIntoView(id) {
    const index = rows.findIndex((r) => r.node.id === id);
    if (index < 0) return;
    const top = index * ROW_H;
    const bottom = top + ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top - ROW_H;
    else if (bottom > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = bottom - scroller.clientHeight + ROW_H;
  }

  rowsEl.addEventListener("click", (event) => {
    const el = event.target.closest(".row");
    if (!el) return;
    if (el.dataset.group) {
      // Expanding a `×N` row should land you on its first member, not nowhere.
      const group = rows.find((r) => r.key === el.dataset.group);
      toggleGroup(el.dataset.group);
      if (group) select(group.node.id);
      return;
    }
    if (event.target.closest('.twist[data-twist="1"]')) return toggleCollapsed(el.dataset.id);
    select(el.dataset.id);
    scroller.focus();
  });
  rowsEl.addEventListener("mouseover", (event) => {
    const el = event.target.closest(".row");
    hover(el && !el.dataset.group ? el.dataset.id : null);
  });
  rowsEl.addEventListener("dblclick", (event) => {
    const el = event.target.closest(".row");
    if (el && !el.dataset.group) toggleCollapsed(el.dataset.id);
  });

  new ResizeObserver(paint).observe(scroller);

  return function render(state, projection) {
    if (filterEl.value !== state.query) filterEl.value = state.query;
    foldEl.checked = state.foldRepeats;
    collapseEl.textContent = state.collapsed.size > 0 ? "Expand all" : "Collapse all";
    rows = flattenRows(projection, state).map((row, index) => ({ ...row, index }));
    spacer.style.height = `${rows.length * ROW_H}px`;
    if (pendingScrollTo) {
      scrollIntoView(pendingScrollTo);
      pendingScrollTo = null;
    } else if (state.selectedId !== lastSelectedId && state.selectedId) {
      scrollIntoView(state.selectedId);
    }
    lastSelectedId = state.selectedId;
    paint();
  };
}

/** Called by the shell when the ledger tab is activated. */
export function focusLedgerFilter(container) {
  container.querySelector("#ledger-filter")?.focus();
}

export { ROW_H };
