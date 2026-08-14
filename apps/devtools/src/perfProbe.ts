/**
 * Lightweight main-thread timing probe for timeline / ingest hotspots.
 * Enabled when `localStorage.rl-perf-probe = "1"`.
 */
const marks: Array<{ name: string; ms: number }> = [];

export function perfProbeEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("rl-perf-probe") === "1";
  } catch {
    return false;
  }
}

export function perfMark(name: string, start: number): void {
  if (!perfProbeEnabled()) return;
  const ms = performance.now() - start;
  marks.push({ name, ms });
  if (marks.length > 200) marks.shift();
  if (ms > 16) {
    // eslint-disable-next-line no-console
    console.warn(`[rl-perf] ${name} ${ms.toFixed(1)}ms`);
  }
}

export function perfSnapshot(): ReadonlyArray<{ name: string; ms: number }> {
  return marks;
}
