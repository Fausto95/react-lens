/**
 * Shell: tabs, dataset switch, theme, global keys. Holds no view logic — every
 * lens renders itself from the store.
 */

import { CAUSE_LABEL, DATASETS } from "./data.js";
import * as ledger from "./ledger.js";
import * as rings from "./rings.js";
import * as rollup from "./rollup.js";
import * as rail from "./rail.js";
import { getProjection, getState, loadDataset, subscribe, update } from "./store.js";

const LENSES = [
  {
    id: "ledger",
    label: "Ledger",
    blurb:
      "<b>One column, not a canvas.</b> Depth becomes indentation, so the cascade reads top-to-bottom " +
      "and the list windows — 609 renders cost the same as 33. Repeated siblings fold to one row. " +
      "Solid bar is self time, ghost is subtree.",
    keys: "<kbd>↑</kbd><kbd>↓</kbd> move · <kbd>←</kbd><kbd>→</kbd> fold · <kbd>/</kbd> filter",
  },
  {
    id: "rings",
    label: "Blast rings",
    blurb:
      "<b>Shape of the blast, in one screen.</b> The hub is the root cause, each ring is one causal " +
      "hop, arc width is the share of renders downstream. Hover lights the path back to the cause; " +
      "double-click re-roots.",
    keys: "",
  },
  {
    id: "rollup",
    label: "Roll-up",
    blurb:
      "<b>Aggregate by component, not by render.</b> Count, cause mix, depth spread, cost and a " +
      "verdict. This is the view that answers <i>what do I fix</i> — the other two are the drill-down.",
    keys: "",
  },
];

const app = document.getElementById("app");

app.innerHTML = `
  <header class="topbar">
    <div class="brand">Cascade <span>alternate representations</span></div>
    <div class="segmented" role="tablist" id="lens-tabs">
      ${LENSES.map(
        (lens, i) =>
          `<button role="tab" data-lens="${lens.id}" aria-selected="${i === 0}"` +
          ` aria-controls="view-${lens.id}">${i + 1} · ${lens.label}</button>`,
      ).join("")}
    </div>
    <div class="segmented" id="dataset-tabs" role="group" aria-label="Dataset">
      ${DATASETS.map(
        (d, i) =>
          `<button data-dataset="${d.id}" aria-pressed="${i === 0}" title="${d.hint}">${d.label}</button>`,
      ).join("")}
    </div>
    <div class="spacer"></div>
    <div class="metrics" id="metrics"></div>
    <button class="icon-btn" id="theme-toggle" aria-label="Toggle colour scheme">Theme</button>
  </header>

  <div class="explain">
    <p id="blurb"></p>
    <div class="legend">
      ${Object.keys(CAUSE_LABEL)
        .map((c) => `<span><i class="dot cause-${c}"></i>${CAUSE_LABEL[c]}</span>`)
        .join("")}
    </div>
  </div>

  <div class="views">
    ${LENSES.map(
      (lens) =>
        `<section class="view" id="view-${lens.id}" data-view="${lens.id}" role="tabpanel">` +
        `<div data-slot="main"></div><aside data-slot="rail"></aside></section>`,
    ).join("")}
  </div>`;

const views = new Map();
for (const lens of LENSES) {
  const section = app.querySelector(`#view-${lens.id}`);
  const main = section.querySelector('[data-slot="main"]');
  const railEl = section.querySelector('[data-slot="rail"]');
  const renderMain =
    lens.id === "ledger"
      ? ledger.mount(main)
      : lens.id === "rings"
        ? rings.mount(main)
        : rollup.mount(main, update);
  views.set(lens.id, { section, renderMain, renderRail: rail.mount(railEl) });
}

const blurbEl = app.querySelector("#blurb");
const metricsEl = app.querySelector("#metrics");

app.querySelector("#lens-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-lens]");
  if (button) update({ tab: button.dataset.lens });
});
app.querySelector("#dataset-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-dataset]");
  if (button) loadDataset(button.dataset.dataset);
});
app
  .querySelector("#theme-toggle")
  .addEventListener("click", () =>
    update({ theme: getState().theme === "dark" ? "light" : "dark" }),
  );

window.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea");
  if (event.key === "/" && !typing) {
    event.preventDefault();
    update({ tab: "ledger" });
    ledger.focusLedgerFilter(app.querySelector("#view-ledger"));
    return;
  }
  if (event.key === "Escape" && typing) {
    event.target.blur();
    update({ query: "" });
    return;
  }
  if (!typing && ["1", "2", "3"].includes(event.key)) {
    update({ tab: LENSES[Number(event.key) - 1].id });
  }
});

function render(state, projection) {
  document.documentElement.dataset.theme = state.theme;

  for (const button of app.querySelectorAll("#lens-tabs button"))
    button.setAttribute("aria-selected", String(button.dataset.lens === state.tab));
  for (const button of app.querySelectorAll("#dataset-tabs button"))
    button.setAttribute("aria-pressed", String(button.dataset.dataset === state.datasetId));

  const lens = LENSES.find((l) => l.id === state.tab);
  blurbEl.innerHTML =
    lens.blurb + (lens.keys ? ` <span style="white-space:nowrap">${lens.keys}</span>` : "");

  metricsEl.innerHTML =
    `<span><b>${projection.nodes.length}</b> renders</span>` +
    `<span><b>${projection.totalSelf.toFixed(2)}</b> ms self</span>` +
    `<span class="opt">depth <b>${projection.maxDepth}</b></span>` +
    `<span class="opt"><b>${projection.componentCount}</b> components</span>`;

  for (const [id, view] of views) {
    const active = id === state.tab;
    view.section.dataset.active = String(active);
    if (!active) continue;
    view.renderMain(state, projection);
    view.renderRail(state, projection);
  }
}

subscribe(render);
render(getState(), getProjection());
