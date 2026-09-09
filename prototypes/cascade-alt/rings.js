/**
 * Lens 2 — Blast rings.
 *
 * The hub is the root cause; each ring is one causal hop; arc width is the share
 * of renders downstream; fill strength is cost share. You read *how far* and
 * *how wide* the update propagated before you read a single name.
 */

import { chainOf } from "./data.js";
import { getProjection, getState, hover, select, update } from "./store.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const HUB_R = 46;
const R0 = 92;
const RING = 56;
const GAP = 0.005;
/** Below this arc length an arc is a sliver: not drawn, but counted and reported. */
const MIN_ARC_PX = 2.5;
/** A label needs room. Anything tighter stays unlabelled rather than overlapping. */
const MIN_LABEL_PX = 34;

function el(name, attrs, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = text;
  return node;
}

function arcPath(cx, cy, a0, a1, r0, r1) {
  const point = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(a0, r1);
  const [x1, y1] = point(a1, r1);
  const [x2, y2] = point(a1, r0);
  const [x3, y3] = point(a0, r0);
  // A full turn cannot be expressed as one arc — split it.
  if (a1 - a0 >= Math.PI * 1.999) {
    return (
      `M${cx + r1} ${cy}A${r1} ${r1} 0 1 1 ${cx - r1} ${cy}A${r1} ${r1} 0 1 1 ${cx + r1} ${cy}Z` +
      `M${cx + r0} ${cy}A${r0} ${r0} 0 1 0 ${cx - r0} ${cy}A${r0} ${r0} 0 1 0 ${cx + r0} ${cy}Z`
    );
  }
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Angular slices for every node under `root`, breadth-first. */
export function computeSlices(root, minArcPx) {
  const slices = [];
  let hidden = 0;
  const walk = (node, a0, a1, depth) => {
    if (depth > 0) {
      const radius = R0 + (depth - 1) * RING + RING / 2;
      if ((a1 - a0) * radius < minArcPx) {
        hidden += node.subtreeCount;
        return;
      }
      slices.push({ node, a0, a1, depth });
    }
    let a = a0;
    for (const child of node.children) {
      const span = ((a1 - a0) * child.leafCount) / node.leafCount;
      walk(child, a, a + span, depth + 1);
      a += span;
    }
  };
  walk(root, -Math.PI / 2, Math.PI * 1.5, 0);
  return { slices, hidden };
}

/** Rings needed below `root` — re-rooting must not leave empty guides. */
function subtreeDepth(root) {
  let max = 0;
  const stack = [[root, 0]];
  while (stack.length > 0) {
    const [node, d] = stack.pop();
    if (d > max) max = d;
    for (const child of node.children) stack.push([child, d + 1]);
  }
  return max;
}

export function mount(container) {
  container.innerHTML = `
    <div class="pane rings-pane">
      <div class="toolbar">
        <nav class="crumbs" id="ring-crumbs" aria-label="Ring root"></nav>
        <span class="spacer"></span>
        <span class="pill" id="ring-note"></span>
      </div>
      <div class="scroller" style="overflow:hidden">
        <svg id="rings" role="img" aria-label="Radial map of the render cascade"></svg>
      </div>
    </div>`;

  const svg = container.querySelector("#rings");
  const crumbs = container.querySelector("#ring-crumbs");
  const note = container.querySelector("#ring-note");
  let size = { w: 900, h: 640 };

  new ResizeObserver((entries) => {
    const box = entries[0].contentRect;
    if (box.width < 40 || box.height < 40) return;
    size = { w: box.width, h: box.height };
    draw();
  }).observe(svg.parentElement);

  svg.addEventListener("mouseleave", () => hover(null));

  function draw() {
    const projection = getProjection();
    const state = getState();
    const root = projection.byId.get(state.ringRootId ?? "") ?? projection.roots[0];
    if (!root) return;

    const cx = size.w / 2;
    const cy = size.h / 2;
    const depth = subtreeDepth(root);
    const needed = R0 + depth * RING + 12;
    const scale = Math.min(1, Math.min(cx, cy) / needed);

    const { slices, hidden } = computeSlices(root, MIN_ARC_PX / scale);
    const focused = state.hoverId ?? state.selectedId;
    const lit = new Set(focused ? chainOf(projection, focused).map((n) => n.id) : []);
    // Only dim when there is an actual path to pick out. Focusing the hub means
    // "show me everything", not "hide everything".
    const dimming = focused != null && focused !== root.id && lit.has(root.id);

    svg.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
    svg.replaceChildren();
    const g = el("g", {
      transform: `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`,
    });
    svg.append(g);

    // Ring guides first, so arcs sit on top of them. Each carries its hop count.
    for (let d = 1; d <= depth; d++) {
      const r = R0 + (d - 1) * RING + RING - 6;
      g.append(el("circle", { class: "ring-guide", cx, cy, r }));
      g.append(
        el("text", { class: "ring-label", x: cx, y: cy - r - 5, "text-anchor": "middle" }, `d${d}`),
      );
    }

    for (const slice of slices) {
      const r0 = R0 + (slice.depth - 1) * RING;
      const r1 = r0 + RING - 6;
      const rr = (r0 + r1) / 2;
      const share = projection.maxTotal > 0 ? slice.node.totalDuration / projection.maxTotal : 0;
      const path = el("path", {
        class: `arc cause-${slice.node.cause}`,
        d: arcPath(cx, cy, slice.a0 + GAP, Math.max(slice.a0 + GAP, slice.a1 - GAP), r0, r1),
        // sqrt so cheap-but-real nodes stay visible instead of dissolving.
        "fill-opacity": (0.42 + 0.5 * Math.sqrt(share)).toFixed(3),
        "stroke-opacity": 0.9,
        "stroke-width": 1,
      });
      if (dimming && !lit.has(slice.node.id)) path.dataset.muted = "true";
      path.dataset.id = slice.node.id;
      g.append(path);

      const span = (slice.a1 - slice.a0) * rr;
      if (span < MIN_LABEL_PX) continue;
      const mid = (slice.a0 + slice.a1) / 2;
      const deg = (mid * 180) / Math.PI;
      const flip = deg > 90 || deg < -90;
      const x = cx + Math.cos(mid) * rr;
      const y = cy + Math.sin(mid) * rr;
      const room = Math.floor(span / 6.2);
      const name =
        slice.node.name.length > room
          ? `${slice.node.name.slice(0, Math.max(1, room - 1))}…`
          : slice.node.name;
      g.append(
        el(
          "text",
          {
            class: "arc-label",
            x,
            y,
            "font-size": 10,
            "text-anchor": "middle",
            "dominant-baseline": "central",
            opacity: dimming && !lit.has(slice.node.id) ? 0.15 : 0.94,
            transform: `rotate(${flip ? deg + 180 : deg} ${x} ${y})`,
          },
          name,
        ),
      );
    }

    g.append(
      el("circle", {
        cx,
        cy,
        r: HUB_R,
        "fill-opacity": 0.95,
        class: `arc cause-${root.cause}`,
        "stroke-width": 0,
        "data-id": root.id,
      }),
    );
    g.append(
      el(
        "text",
        {
          x: cx,
          y: cy - 5,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-size": 11,
          "font-weight": 600,
          fill: "#0a0a0b",
        },
        root.name.length > 11 ? `${root.name.slice(0, 10)}…` : root.name,
      ),
    );
    g.append(
      el(
        "text",
        {
          x: cx,
          y: cy + 9,
          "text-anchor": "middle",
          "dominant-baseline": "central",
          "font-size": 9,
          fill: "rgba(10,10,11,0.66)",
        },
        `${root.subtreeCount - 1} downstream`,
      ),
    );

    note.textContent = hidden > 0 ? `${hidden} renders too thin to draw` : `${slices.length} arcs`;
    note.style.color = hidden > 0 ? "var(--warn)" : "";

    const path = chainOf(projection, root.id);
    crumbs.replaceChildren();
    path.forEach((node, i) => {
      if (i > 0) crumbs.append(Object.assign(document.createElement("span"), { textContent: "›" }));
      const button = document.createElement("button");
      button.textContent = node.name;
      button.title = `Re-root the rings at ${node.name}`;
      button.addEventListener("click", () =>
        update({ ringRootId: node.parentId == null ? null : node.id, selectedId: node.id }),
      );
      crumbs.append(button);
    });
  }

  svg.addEventListener("mouseover", (event) => {
    const id = event.target.dataset?.id;
    hover(id ?? null);
  });
  svg.addEventListener("click", (event) => {
    const id = event.target.dataset?.id;
    if (id) select(id);
  });
  svg.addEventListener("dblclick", (event) => {
    const id = event.target.dataset?.id;
    if (!id) return;
    const node = getProjection().byId.get(id);
    if (node?.children.length) update({ ringRootId: id, selectedId: id });
  });

  return draw;
}
