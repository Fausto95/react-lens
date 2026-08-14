import { describe, it, expect } from "vite-plus/test";
import { snapshotDom } from "./dom-snapshot.js";

function deepTree(depth: number): HTMLElement {
  const root = document.createElement("div");
  let cur: HTMLElement = root;
  for (let i = 0; i < depth; i++) {
    const child = document.createElement("section");
    child.setAttribute("data-level", String(i));
    cur.appendChild(child);
    cur = child;
  }
  cur.textContent = "leaf";
  return root;
}

describe("snapshotDom limits", () => {
  it("defaults keep the render-snapshot budget (depth 6)", () => {
    const snap = snapshotDom(deepTree(10))!;
    let node = snap.root;
    let depth = 0;
    while (node.children?.[0]) {
      node = node.children[0];
      depth++;
    }
    expect(depth).toBe(6);
    expect(snap.root.visual).toBeUndefined();
  });

  it("accepts a larger budget for whole-page commit captures", () => {
    const snap = snapshotDom(deepTree(10), { maxDepth: 12, maxChildren: 64 })!;
    let node = snap.root;
    let depth = 0;
    while (node.children?.[0]) {
      node = node.children[0];
      depth++;
    }
    // 10 nested sections + the leaf text node.
    expect(depth).toBe(11);
    expect(node.text).toBe("leaf");
  });

  it("caps children per node at the configured limit", () => {
    const root = document.createElement("ul");
    for (let i = 0; i < 40; i++) root.appendChild(document.createElement("li"));
    expect(snapshotDom(root)!.root.children).toHaveLength(32);
    expect(snapshotDom(root, { maxChildren: 5 })!.root.children).toHaveLength(5);
  });
});

describe("snapshotDom visual history", () => {
  it("captures resolved CSS independently of how the style was authored", () => {
    const root = document.createElement("div");
    root.style.display = "flex";
    root.style.opacity = "0.5";
    root.style.setProperty("--panel-width", "320px");
    document.body.appendChild(root);

    const snap = snapshotDom(root, { captureVisuals: true })!;
    expect(snap.root.visual?.computedStyle?.display).toBe("flex");
    expect(snap.root.visual?.computedStyle?.opacity).toBe("0.5");
    expect(snap.root.visual?.customProperties?.["--panel-width"]).toBe("320px");
    expect(snap.root.visual?.rect).toBeDefined();

    root.remove();
  });

  it("can explicitly disable visual capture for custom structural budgets", () => {
    const root = document.createElement("div");
    const snap = snapshotDom(root, { maxDepth: 12, captureVisuals: false })!;
    expect(snap.root.visual).toBeUndefined();
  });
});
