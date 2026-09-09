/**
 * One state object, one writer, three views reading from it. Selection is
 * shared: picking a node in any lens moves the other two.
 */

import { buildProjection, DATASETS } from "./data.js";

const listeners = new Set();

const state = {
  datasetId: "site",
  tab: "ledger",
  /** Node id. The single selection anchor across all three lenses. */
  selectedId: null,
  /** Node id under the pointer — transient, never persisted. */
  hoverId: null,
  query: "",
  foldRepeats: true,
  /** Collapsed subtree ids (ledger). */
  collapsed: new Set(),
  /** Expanded `×N` sibling-group keys (ledger). */
  expandedGroups: new Set(),
  /** Ring view can re-root into a subtree. */
  ringRootId: null,
  sort: { key: "self", dir: "desc" },
  theme: "dark",
};

let projection = buildProjection(DATASETS[0].rows);

export function getState() {
  return state;
}

export function getProjection() {
  return projection;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state, projection);
}

/** The only writer. Every mutation funnels through here. */
export function update(patch) {
  Object.assign(state, patch);
  emit();
}

export function loadDataset(datasetId) {
  const dataset = DATASETS.find((d) => d.id === datasetId);
  if (!dataset) throw new Error(`unknown dataset: ${datasetId}`);
  projection = buildProjection(dataset.rows);
  Object.assign(state, {
    datasetId,
    selectedId: projection.roots[0]?.id ?? null,
    hoverId: null,
    query: "",
    collapsed: new Set(),
    expandedGroups: new Set(),
    ringRootId: null,
  });
  emit();
}

export function select(id) {
  if (id === state.selectedId) return;
  update({ selectedId: id });
}

export function hover(id) {
  if (id === state.hoverId) return;
  update({ hoverId: id });
}

/** Hover wins over selection for "what am I looking at", as in the panel. */
export function focusedId() {
  return state.hoverId ?? state.selectedId;
}

export function toggleCollapsed(id) {
  const next = new Set(state.collapsed);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  update({ collapsed: next });
}

export function toggleGroup(key) {
  const next = new Set(state.expandedGroups);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  update({ expandedGroups: next });
}

/** Reveal a node: uncollapse and un-fold every ancestor, then select it. */
export function reveal(id) {
  const collapsed = new Set(state.collapsed);
  const expandedGroups = new Set(state.expandedGroups);
  for (
    let n = projection.byId.get(id);
    n;
    n = n.parentId ? projection.byId.get(n.parentId) : null
  ) {
    collapsed.delete(n.id);
    if (n.parentId != null) expandedGroups.add(`${n.parentId}|${n.shape}`);
  }
  update({ collapsed, expandedGroups, selectedId: id });
}

loadDataset("site");
