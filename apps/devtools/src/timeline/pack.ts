import type { TraceStore, Interaction } from "@react-lens/trace-engine";
import type { ComponentId, RenderId } from "@react-lens/protocol";

/**
 * Safety valve, not routine truncation: LOD clustering keeps the DOM small,
 * so the cap only trips on pathological single-interaction bursts.
 */
export const PHASE_BAR_CAP = 1000;
/** Minimum clickable width when a render is sub-pixel on the scale. */
export const MIN_BAR_PX = 3;

export interface PackedBar {
  id: ComponentId;
  renderId: RenderId;
  name: string;
  phaseId: string;
  phaseLabel: string;
  t0: number;
  t1: number;
  self: number;
  heat: number;
  reason: string;
  track: number;
  left: number;
  width: number;
  /** Free px after this box before the next bar on the same track. */
  labelRoom: number;
}

export interface PackedPhase {
  id: string;
  label: string;
  left: number;
  width: number;
  barCount: number;
  renderCount: number;
}

/**
 * Wall-clock component waterfall layout: one bar per render, placed at
 * xOf(timestamp) with width from self-duration; overlapping renders stack
 * onto tracks. Interaction phase columns come back as background boxes.
 *
 * Packing happens in TIME — `px` enters only as the min-width epsilon
 * (MIN_BAR_PX/px) — so track assignment doesn't depend on the scale's
 * idle-gutter compression and stays stable while zooming.
 */
export function packPhaseBars(
  store: TraceStore,
  interactions: Interaction[],
  xOf: (t: number) => number,
  px: number,
): { phases: PackedPhase[]; bars: PackedBar[]; trackCount: number } {
  const phases: PackedPhase[] = [];
  const bars: PackedBar[] = [];
  let trackCount = 1;
  const minWidthMs = MIN_BAR_PX / Math.max(px, 1e-6);

  type Agg = {
    id: ComponentId;
    renderId: RenderId;
    name: string;
    t0: number;
    t1: number;
    self: number;
    reason: string;
    left: number;
    width: number;
  };

  for (const it of interactions) {
    const phaseLeft = xOf(it.start);
    const phaseRight = xOf(Math.max(it.end, it.start + 0.05));
    const phaseWidth = Math.max(8, phaseRight - phaseLeft);

    const items: Agg[] = [];

    for (const rid of it.renderIds) {
      const r = store.getRender(rid);
      if (!r) continue;
      const name = store.instance(r.componentId)?.name ?? `#${r.componentId}`;
      const t0 = r.timestamp;
      const t1 = r.timestamp + Math.max(r.selfDuration, 0.05);
      const left = xOf(t0);
      const width = Math.max(MIN_BAR_PX, xOf(t1) - left);
      items.push({
        id: r.componentId,
        renderId: r.renderId,
        name,
        t0,
        t1,
        self: r.selfDuration,
        reason: r.reasons[0]?.type ?? "render",
        left,
        width,
      });
    }

    // Prefer costliest renders when capped; layout still follows wall-clock.
    const ranked = [...items].sort((a, b) => b.self - a.self).slice(0, PHASE_BAR_CAP);

    phases.push({
      id: it.id,
      label: it.label,
      left: phaseLeft,
      width: phaseWidth,
      barCount: ranked.length,
      renderCount: items.length,
    });

    if (ranked.length === 0) continue;

    const maxSelf = Math.max(0, ...ranked.map((a) => a.self));
    // Pack in time, padded so min-width boxes don't overlap on screen.
    const packedItems = greedyPack(
      ranked.map((item) => ({
        item,
        t0: item.t0,
        t1: Math.max(item.t1, item.t0 + minWidthMs),
      })),
      0.5 * minWidthMs,
    );
    for (const packed of packedItems) {
      const item = packed.item;
      trackCount = Math.max(trackCount, packed.track + 1);
      bars.push({
        id: item.id,
        renderId: item.renderId,
        name: item.name,
        phaseId: it.id,
        phaseLabel: it.label,
        t0: item.t0,
        t1: item.t1,
        self: item.self,
        heat: maxSelf <= 0 ? 1 : item.self / maxSelf,
        reason: item.reason,
        track: packed.track,
        left: item.left,
        width: item.width,
        labelRoom: Number.POSITIVE_INFINITY,
      });
    }
  }

  // Free run after each box on its track — decides where outside labels fit.
  const byTrack = new Map<number, PackedBar[]>();
  for (const bar of bars) {
    const list = byTrack.get(bar.track) ?? [];
    list.push(bar);
    byTrack.set(bar.track, list);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.left - b.left);
    for (let i = 0; i < list.length - 1; i++) {
      list[i]!.labelRoom = Math.max(0, list[i + 1]!.left - (list[i]!.left + list[i]!.width) - 6);
    }
  }

  return { phases, bars, trackCount };
}

/**
 * Assign non-overlapping tracks (greedy). Unit-agnostic — callers pass px or
 * time intervals; `tolerance` is the near-touch slack in the same unit.
 */
export function greedyPack<T extends { t0: number; t1: number }>(
  items: T[],
  tolerance = 0.5,
): Array<T & { track: number }> {
  const sorted = [...items].sort(
    (a, b) => a.t0 - b.t0 || b.t1 - b.t0 - (a.t1 - a.t0),
  );
  const trackEnds: number[] = [];
  return sorted.map((item) => {
    let track = trackEnds.findIndex((end) => end <= item.t0 + tolerance);
    if (track < 0) {
      track = trackEnds.length;
      trackEnds.push(item.t1);
    } else {
      trackEnds[track] = item.t1;
    }
    return { ...item, track };
  });
}
