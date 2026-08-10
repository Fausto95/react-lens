import type { ComponentId } from "@react-lens/protocol";
import type { CommitObservation } from "@react-lens/fiber";
import type { LensRuntime } from "./runtime.js";

/**
 * React-Scan-style render overlay. On each commit, flashes an outline over
 * every rendered component's DOM, colored by self-duration, with a cumulative
 * render count. Embedded-only (draws on the inspected page directly).
 */
export interface RenderOverlay {
  enable(): void;
  disable(): void;
  enabled(): boolean;
  dispose(): void;
}

interface HeatBucket {
  color: string;
  label: string;
}

function heat(ms: number): HeatBucket {
  if (ms < 1) return { color: "74,222,128", label: "" }; // green
  if (ms < 5) return { color: "251,191,36", label: "" }; // yellow
  if (ms < 16) return { color: "251,146,60", label: "" }; // orange
  return { color: "248,113,113", label: "" }; // red
}

export function createRenderOverlay(runtime: LensRuntime): RenderOverlay {
  let layer: HTMLDivElement | null = null;
  let dispose: (() => void) | null = null;
  const counts = new Map<ComponentId, number>();

  function ensureLayer(): HTMLDivElement {
    if (layer) return layer;
    const el = document.createElement("div");
    el.id = "react-lens-render-overlay";
    Object.assign(el.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147482998",
      overflow: "hidden",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(el);
    layer = el;
    return el;
  }

  function draw(commit: CommitObservation): void {
    if (!layer) return;
    for (const id of commit.rendered) {
      const nodes = runtime.domNodesOf(id);
      const rect = unionRect(nodes);
      if (!rect) continue;
      const detail = commit.details.get(id);
      const dur = detail?.selfDuration ?? 0;
      const next = (counts.get(id) ?? 0) + 1;
      counts.set(id, next);
      flash(layer, rect, heat(dur), next);
    }
  }

  function enable(): void {
    if (dispose) return;
    ensureLayer();
    dispose = runtime.onCommit(draw);
  }

  function disable(): void {
    dispose?.();
    dispose = null;
    if (layer) layer.innerHTML = "";
    counts.clear();
  }

  return {
    enable,
    disable,
    enabled: () => dispose !== null,
    dispose() {
      disable();
      layer?.remove();
      layer = null;
    },
  };
}

function unionRect(nodes: Node[]): DOMRect | null {
  let out: DOMRect | null = null;
  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const r = (node as Element).getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (!out) {
      out = new DOMRect(r.x, r.y, r.width, r.height);
    } else {
      const x = Math.min(out.x, r.x);
      const y = Math.min(out.y, r.y);
      const right = Math.max(out.x + out.width, r.x + r.width);
      const bottom = Math.max(out.y + out.height, r.y + r.height);
      out = new DOMRect(x, y, right - x, bottom - y);
    }
  }
  return out;
}

function flash(layer: HTMLDivElement, rect: DOMRect, bucket: HeatBucket, count: number): void {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "absolute",
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    outline: `1px solid rgba(${bucket.color},0.9)`,
    background: `rgba(${bucket.color},0.12)`,
    borderRadius: "2px",
    transition: "opacity 420ms ease-out",
    opacity: "1",
  } satisfies Partial<CSSStyleDeclaration>);

  const label = document.createElement("span");
  Object.assign(label.style, {
    position: "absolute",
    top: "0",
    right: "0",
    transform: "translateY(-100%)",
    font: "10px/1.4 ui-monospace, monospace",
    padding: "0 4px",
    color: "#0b0d10",
    background: `rgb(${bucket.color})`,
    borderRadius: "3px 3px 0 0",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  label.textContent = `×${count}`;
  box.appendChild(label);

  layer.appendChild(box);
  // Fade then remove on the next frames.
  requestAnimationFrame(() => {
    box.style.opacity = "0";
    setTimeout(() => box.remove(), 460);
  });
}
