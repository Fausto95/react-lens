import { timeAxis } from "@react-lens/ui";
import { projectX, type Seg } from "./geometry.js";

export interface Tick {
  x: number;
  major: boolean;
  label: string;
}

export function buildTicks(segs: Seg[], t0: number): Tick[] {
  const ticks: Array<{ x: number; t: number; major: boolean; label: string }> = [];
  const seenX = new Set<number>();
  const pushTick = (t: number, major: boolean) => {
    const x = Math.round(projectX(segs, t) * 10) / 10;
    if (seenX.has(x)) return;
    seenX.add(x);
    ticks.push({ x, t, major, label: "" });
  };

  // Boundary ticks for every scale segment (active + idle) so gutters aren't blank.
  for (const s of segs) {
    pushTick(s.t0, true);
    pushTick(s.t1, true);
  }

  // Interior ticks only on active time — idle is already a single compressed cell.
  for (const s of segs) {
    if (s.idle) continue;
    const span = s.t1 - s.t0;
    const pxSpan = Math.max(1, s.x1 - s.x0);
    // ~1 tick per 48px → a label can sit between adjacent tick lines.
    const targetSteps = Math.max(1, Math.floor(pxSpan / 48));
    const step = niceStep(span / targetSteps);
    // Walk from the first step strictly inside the segment (edges already added).
    let t = Math.ceil((s.t0 + step * 0.25) / step) * step;
    while (t < s.t1 - step * 0.25) {
      pushTick(t, false);
      t += step;
    }
  }

  ticks.sort((a, b) => a.x - b.x);

  // Label every tick that has room — not only "major" — so each cell gets a time.
  let lastLabelX = -Infinity;
  let lastLabelText = "";
  for (const tick of ticks) {
    if (tick.x - lastLabelX < 40) continue;
    const label = timeAxis(tick.t - t0);
    // Gutter boundaries sit close in time; identical rounded labels are noise.
    if (label === lastLabelText) continue;
    tick.label = label;
    tick.major = true;
    lastLabelX = tick.x;
    lastLabelText = label;
  }
  return ticks.map(({ x, major, label }) => ({ x, major, label }));
}

export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n < 1.5) return pow;
  if (n < 3.5) return 2 * pow;
  if (n < 7.5) return 5 * pow;
  return 10 * pow;
}

/** Short gap label for the 34px idle gutter. */
export function compactGap(msVal: number): string {
  if (msVal >= 60_000) return `${Math.round(msVal / 60_000)}m`;
  if (msVal >= 1000) {
    const s = msVal / 1000;
    return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
  }
  return `${Math.round(msVal)}ms`;
}
