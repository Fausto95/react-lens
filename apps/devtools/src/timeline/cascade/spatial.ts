import type { CascadeLayoutNode, CascadeRect } from "./layout.js";

const DEFAULT_CELL = 96;

function intersectsPoint(rect: CascadeRect, x: number, y: number, pad: number): boolean {
  return (
    x >= rect.x - pad &&
    x <= rect.x + rect.width + pad &&
    y >= rect.y - pad &&
    y <= rect.y + rect.height + pad
  );
}

/** Fixed-grid spatial index built once per cascade layout. Pan/zoom never rebuild it. */
export class CascadeSpatialIndex {
  private readonly cells = new Map<string, CascadeLayoutNode[]>();
  private readonly cellSize: number;

  constructor(nodes: readonly CascadeLayoutNode[], cellSize = DEFAULT_CELL) {
    this.cellSize = cellSize;
    for (const node of nodes) {
      const r = node.rect;
      const x0 = Math.floor(r.x / cellSize);
      const x1 = Math.floor((r.x + r.width) / cellSize);
      const y0 = Math.floor(r.y / cellSize);
      const y1 = Math.floor((r.y + r.height) / cellSize);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x}:${y}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(node);
          else this.cells.set(key, [node]);
        }
      }
    }
  }

  hit(x: number, y: number, hitPadding = 6): CascadeLayoutNode | null {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    let best: CascadeLayoutNode | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const node of this.cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (!intersectsPoint(node.rect, x, y, hitPadding)) continue;
          const centerX = node.rect.x + node.rect.width / 2;
          const centerY = node.rect.y + node.rect.height / 2;
          const inside = intersectsPoint(node.rect, x, y, 0);
          const score = (inside ? -1000 : 0) + Math.abs(x - centerX) + Math.abs(y - centerY) * 0.35;
          if (score < bestScore) {
            bestScore = score;
            best = node;
          }
        }
      }
    }

    return best;
  }
}
