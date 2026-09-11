/**
 * The shared inspector rail, in the panel's rhetorical order:
 * Cause → Change → Cost → Fix (DESIGN.md §1.4).
 *
 * One rail, three lenses. Whatever is hovered or selected anywhere lands here.
 */

import { CAUSE_LABEL, CAUSE_STORY, chainOf } from "./data.js";
import { select } from "./store.js";

function ms(value) {
  return value < 0.01 ? "<0.01" : value.toFixed(2);
}

/** The concrete next step, derived from the node's own evidence. */
export function fixFor(node, projection, siblingsSameName) {
  const share = projection.totalSelf > 0 ? node.totalDuration / projection.totalSelf : 0;
  if (node.cause === "context" && siblingsSameName >= 3)
    return {
      title: "Split the context, or select from it",
      body:
        `<code>${node.name}</code> re-rendered ${siblingsSameName}× because one context value ` +
        `changed. Every consumer of a context re-renders on any change to it — split the ` +
        `provider so unrelated values do not travel together.`,
    };
  if (node.cause === "props" && share > 0.2)
    return {
      title: "A new prop identity is dragging a subtree",
      body:
        `<code>${node.name}</code> owns ${(share * 100).toFixed(0)}% of this cascade and rendered ` +
        `because a prop changed identity. Check whether the value is structurally identical ` +
        `render-to-render — if so, the Compiler could not memoize it and the callsite needs a stable value.`,
    };
  if (node.cause === "parent" && node.selfDuration < 0.05 && node.subtreeCount > 1)
    return {
      title: "Pass-through render",
      body:
        `<code>${node.name}</code> did ${ms(node.selfDuration)} ms of its own work but carried ` +
        `${node.subtreeCount - 1} descendants along. Cutting the parent's render cuts all of them.`,
    };
  if (node.cause === "state")
    return {
      title: "This is the root cause",
      body:
        `The interaction starts here: <code>${node.name}</code> set its own state, and ` +
        `${node.subtreeCount - 1} renders followed. Moving this state down the tree shrinks the blast radius.`,
    };
  return {
    title: "Nothing to cut here",
    body: `<code>${node.name}</code> costs ${ms(node.selfDuration)} ms of ${ms(
      projection.totalSelf,
    )} ms. Look upstream — its parent decides whether it renders at all.`,
  };
}

export function mount(container) {
  container.className = "rail";
  container.setAttribute("aria-live", "polite");

  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (button) select(button.dataset.id);
  });

  return function render(state, projection) {
    const node = projection.byId.get(state.hoverId ?? state.selectedId ?? "");
    if (!node) {
      container.innerHTML = `<p class="placeholder">Select a render to inspect it.</p>`;
      return;
    }

    const chain = chainOf(projection, node.id);
    const sameName = projection.nodes.filter((n) => n.name === node.name).length;
    const fix = fixFor(node, projection, sameName);
    const share = projection.totalSelf > 0 ? node.totalDuration / projection.totalSelf : 0;

    container.innerHTML =
      `<h3><span class="dot cause-${node.cause}"></span>${node.name}</h3>` +
      `<p class="sub">Rendered because ${CAUSE_STORY[node.cause]}.</p>` +
      `<h4>Cause — path from the root</h4>` +
      `<div class="chain">${chain
        .map(
          (n, i) =>
            `<button data-id="${n.id}" data-current="${n.id === node.id}"` +
            ` style="padding-left:${5 + i * 9}px">` +
            `<span class="dot cause-${n.cause}"></span><span>${n.name}</span>` +
            `<span class="why">${CAUSE_LABEL[n.cause]}</span></button>`,
        )
        .join("")}</div>` +
      `<h4>Change — what it pulled in</h4>` +
      `<div class="facts">` +
      `<span>Direct children</span><b>${node.children.length}</b>` +
      `<span>Renders below it</span><b>${node.subtreeCount - 1}</b>` +
      `<span>Causal depth</span><b>d${node.depth}</b>` +
      `<span>Same component this interaction</span><b>${sameName}×</b>` +
      `</div>` +
      `<h4>Cost</h4>` +
      `<div class="facts">` +
      `<span>Self</span><b>${ms(node.selfDuration)} ms</b>` +
      `<span>Subtree</span><b>${ms(node.totalDuration)} ms</b>` +
      `<span>Share of interaction</span><b>${(share * 100).toFixed(0)}%</b>` +
      `</div>` +
      `<h4>Fix</h4>` +
      `<div class="fix"><p><b style="color:var(--text)">${fix.title}</b></p><p>${fix.body}</p></div>`;
  };
}
