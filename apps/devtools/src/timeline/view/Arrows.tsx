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
        y: r.top - base.top + host.scrollTop + r.height / 2,
      };
    };
    const next: string[] = [];
    for (const edge of edges) {
      const a = rectOf(edge.from);
      const b = rectOf(edge.to);
      if (!a || !b) continue;
      const x1 = a.right - 4;
      const x2 = b.left + 4;
      next.push(`M ${x1} ${a.y} C ${x1 + 40} ${a.y}, ${x2 - 40} ${b.y}, ${x2} ${b.y}`);
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
