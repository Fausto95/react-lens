import { useLayoutEffect, useState, type RefObject } from "react";
import type { RenderId } from "@reactlens/protocol";
import type { CausalEdge } from "../model/edges.js";

/**
 * Causality arrows between clip boxes.
 *
 * Endpoints are **measured from the rendered clips**, never recomputed from
 * the time model. A clip is drawn at a legibility floor, so a sub-millisecond
 * render's true right edge is nowhere near its projected end; deriving the
 * curve analytically left arrows floating beside the boxes they point at.
 * Measuring also means an edge whose endpoint isn't drawn (a collapsed group)
 * is simply skipped rather than pointing into empty space.
 */
/**
 * Clear horizontal room needed before an edge is routed side-to-side. Below
 * this the curve would double back, so it drops through the lanes instead.
 */
const SIDE_ROUTE_MIN_PX = 24;

export function Arrows({
  edges,
  hostRef,
}: {
  edges: readonly CausalEdge[];
  /** The positioned canvas the paths are relative to. */
  hostRef: RefObject<HTMLElement | null>;
}) {
  const [paths, setPaths] = useState<string[]>([]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || edges.length === 0) {
      setPaths((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const base = host.getBoundingClientRect();
    const rectOf = (id: RenderId) => {
      const el = host.querySelector(`[data-clip="${String(id)}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - base.left + host.scrollLeft,
        right: r.right - base.left + host.scrollLeft,
        cx: r.left - base.left + host.scrollLeft + r.width / 2,
        top: r.top - base.top + host.scrollTop,
        bottom: r.top - base.top + host.scrollTop + r.height,
        y: r.top - base.top + host.scrollTop + r.height / 2,
      };
    };
    const next: string[] = [];
    for (const edge of edges) {
      const a = rectOf(edge.from);
      const b = rectOf(edge.to);
      if (!a || !b) continue;
      const gap = b.left - a.right;
      if (gap > SIDE_ROUTE_MIN_PX) {
        // Room to the right: leave the cause's trailing edge and enter the
        // effect's leading edge, the way the concept draws it.
        const x1 = a.right - 4;
        const x2 = b.left + 4;
        const bend = Math.max(16, Math.min(48, gap / 2));
        next.push(`M ${x1} ${a.y} C ${x1 + bend} ${a.y}, ${x2 - bend} ${b.y}, ${x2} ${b.y}`);
      } else {
        // A synchronous cascade lands in the same millisecond, so the effect
        // is not to the right of its cause — often slightly left. Routing
        // edge-to-edge there makes the curve double back on itself and cross
        // its neighbours. Drop down the lanes instead, which is how a cascade
        // reads anyway.
        const down = b.top >= a.bottom;
        const y1 = down ? a.bottom : a.top;
        const y2 = down ? b.top : b.bottom;
        const bend = Math.max(10, Math.min(30, Math.abs(y2 - y1) / 2));
        const c1 = down ? y1 + bend : y1 - bend;
        const c2 = down ? y2 - bend : y2 + bend;
        next.push(`M ${a.cx} ${y1} C ${a.cx} ${c1}, ${b.cx} ${c2}, ${b.cx} ${y2}`);
      }
    }
    // Identity-stable when unchanged, so measuring cannot loop.
    setPaths((prev) =>
      prev.length === next.length && prev.every((p, i) => p === next[i]) ? prev : next,
    );
  });

  if (paths.length === 0) return null;
  // No viewBox: the paths are already in the canvas's own pixels, and a viewBox
  // built from a stale measurement would rescale them off their clips.
  return (
    <svg className="arrows">
      <defs>
        <marker
          id="ah"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill="#A78BFA" />
        </marker>
      </defs>
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke="#A78BFA"
          strokeWidth="1.2"
          fill="none"
          opacity="0.8"
          markerEnd="url(#ah)"
        />
      ))}
    </svg>
  );
}
