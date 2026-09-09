/**
 * Lens 3 — Roll-up.
 *
 * Aggregate by component instead of by render. This is the view that answers
 * "what do I fix": count, cause mix, depth spread, cost, and a verdict. The
 * other two lenses are the drill-down from here.
 */

import { CAUSE_LABEL } from "./data.js";
import { getState, hover, reveal } from "./store.js";

const COLUMNS = [
  { key: "name", label: "Component", sortable: true, align: "left" },
  { key: "count", label: "Renders", sortable: true, align: "right" },
  { key: "mix", label: "Why", sortable: false, align: "left" },
  { key: "depth", label: "Depth", sortable: true, align: "left" },
  { key: "self", label: "Self ms", sortable: true, align: "right" },
  { key: "share", label: "Share", sortable: true, align: "right" },
  { key: "verdict", label: "Verdict", sortable: false, align: "left" },
];

/** One row per component name, with the verdict the developer actually acts on. */
export function rollUp(projection) {
  const groups = new Map();
  for (const node of projection.nodes) {
    const group = groups.get(node.name) ?? { name: node.name, items: [], causes: new Map() };
    group.items.push(node);
    group.causes.set(node.cause, (group.causes.get(node.cause) ?? 0) + 1);
    groups.set(node.name, group);
  }

  return [...groups.values()].map((group) => {
    const self = group.items.reduce((total, n) => total + n.selfDuration, 0);
    const share = projection.totalSelf > 0 ? self / projection.totalSelf : 0;
    const depths = group.items.map((n) => n.depth);
    const minDepth = Math.min(...depths);
    const maxDepth = Math.max(...depths);
    const count = group.items.length;
    // "Passenger": rendered repeatedly, never on its own account, for no cost.
    const passenger =
      count >= 3 &&
      group.items.every((n) => n.cause === "parent" || n.cause === "context") &&
      self / count < 0.05;
    const dominantCause = [...group.causes.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const carried = group.items.reduce((total, n) => total + n.subtreeCount - 1, 0);
    const verdict = passenger
      ? {
          tone: "waste",
          text: carried > 0 ? `passenger · carries ${carried} more` : `passenger · no own work`,
        }
      : share > 0.2
        ? { tone: "hot", text: "hot · dominates the cascade" }
        : count >= 3
          ? { tone: "plain", text: `${count}× this interaction` }
          : count === 2
            ? { tone: "quiet", text: "twice" }
            : { tone: "quiet", text: "—" };

    return {
      ...group,
      count,
      self,
      share,
      minDepth,
      maxDepth,
      depth: minDepth,
      dominantCause,
      verdict,
      /** Deepest-cost instance — what "drill down" should land on. */
      anchor: group.items.reduce((a, b) => (b.selfDuration > a.selfDuration ? b : a)),
    };
  });
}

export function sortRows(rows, sort) {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const key = sort.key === "share" ? "self" : sort.key;
    const left = a[key];
    const right = b[key];
    const cmp =
      typeof left === "string" ? left.localeCompare(right) * -1 : (left ?? 0) - (right ?? 0);
    return cmp * dir || a.name.localeCompare(b.name);
  });
}

export function mount(container, setState) {
  container.innerHTML = `
    <div class="pane">
      <div class="toolbar">
        <span class="pill" id="rollup-summary"></span>
        <span class="spacer"></span>
        <span style="color:var(--text-3);font-size:11.5px">Click a row to drill into the ledger</span>
      </div>
      <div class="table-wrap scroller">
        <table id="rollup-table"><thead></thead><tbody></tbody></table>
      </div>
    </div>`;

  const table = container.querySelector("#rollup-table");
  const head = table.querySelector("thead");
  const body = table.querySelector("tbody");
  const summary = container.querySelector("#rollup-summary");

  head.addEventListener("click", (event) => {
    const th = event.target.closest("th[data-sortable]");
    if (!th) return;
    const state = getState();
    const key = th.dataset.key;
    setState({
      sort:
        state.sort.key === key
          ? { key, dir: state.sort.dir === "desc" ? "asc" : "desc" }
          : { key, dir: key === "name" ? "asc" : "desc" },
    });
  });

  body.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-anchor]");
    if (tr) reveal(tr.dataset.anchor);
  });
  body.addEventListener("mouseover", (event) => {
    const tr = event.target.closest("tr[data-anchor]");
    hover(tr ? tr.dataset.anchor : null);
  });
  body.addEventListener("mouseleave", () => hover(null));

  return function render(state, projection) {
    const rows = sortRows(rollUp(projection), state.sort);
    const focused = state.hoverId ?? state.selectedId;
    const focusedName = projection.byId.get(focused ?? "")?.name ?? null;

    summary.textContent = `${projection.nodes.length} renders → ${rows.length} components`;

    head.innerHTML = `<tr>${COLUMNS.map((column) => {
      const active = state.sort.key === column.key;
      return (
        `<th${column.sortable ? ` data-sortable data-key="${column.key}"` : ""}` +
        (active ? ` aria-sort="${state.sort.dir === "asc" ? "ascending" : "descending"}"` : "") +
        ` style="text-align:${column.align}">${column.label}` +
        (column.sortable
          ? `<span class="caret">${active && state.sort.dir === "asc" ? "↑" : "↓"}</span>`
          : "") +
        `</th>`
      );
    }).join("")}</tr>`;

    body.innerHTML = rows
      .map((row) => {
        const mix = [...row.causes.entries()]
          .map(
            ([cause, n]) =>
              `<i class="cause-${cause}" style="flex:${n}" title="${n}× ${CAUSE_LABEL[cause]}"></i>`,
          )
          .join("");
        const depth =
          row.minDepth === row.maxDepth ? `d${row.minDepth}` : `d${row.minDepth}–d${row.maxDepth}`;
        return (
          `<tr data-anchor="${row.anchor.id}" data-selected="${row.name === focusedName}">` +
          `<td><span class="cell-name"><span class="dot cause-${row.dominantCause}"></span>${row.name}</span></td>` +
          `<td class="num">${row.count}</td>` +
          `<td><span class="mix">${mix}</span></td>` +
          `<td class="num" style="text-align:left;color:var(--text-2)">${depth}</td>` +
          `<td class="num">${row.self.toFixed(2)}</td>` +
          `<td class="num" style="color:${row.share > 0.2 ? "var(--warn)" : "var(--text-2)"}">${(
            row.share * 100
          ).toFixed(0)}%</td>` +
          `<td><span class="chip" data-tone="${row.verdict.tone}">${row.verdict.text}</span></td>` +
          `</tr>`
        );
      })
      .join("");
  };
}
