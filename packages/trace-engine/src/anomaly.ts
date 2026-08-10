import type { CommitSummary } from "./trace-store.js";

export interface AnomalyStats {
  median: number;
  p95: number;
  max: number;
  isAnomaly: (c: CommitSummary) => boolean;
}

/**
 * Commit-cost outliers: a commit is an anomaly when it costs at least 5× the
 * median (with an 8ms floor so tiny sessions don't flag noise) AND sits at or
 * above the p95. Shared by the Timeline's ⚠ markers and the agent's evidence
 * pack.
 */
export function anomalyStats(commits: CommitSummary[]): AnomalyStats {
  const times = commits.map((c) => c.totalSelfTime).sort((a, b) => a - b);
  const median = percentile(times, 0.5);
  const p95 = percentile(times, 0.95);
  const max = times[times.length - 1] ?? 1;
  const floor = Math.max(8, median * 5);
  return { median, p95, max, isAnomaly: (c) => c.totalSelfTime >= floor && c.totalSelfTime >= p95 };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[i] ?? 0;
}
