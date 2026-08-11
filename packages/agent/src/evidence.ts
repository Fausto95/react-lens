import { anomalyStats, type TraceStore } from "@reactlens/trace-engine";

/**
 * A ~1-2KB session digest prepended to the first user turn so the model never
 * burns tool steps discovering the basics (what interactions exist, which
 * components dominate, whether anything is anomalous).
 */
export interface EvidencePack {
  stats: { events: number; renders: number; snapshots: number; components: number };
  interactions: Array<{
    id: string;
    label: string;
    kind: string;
    durationMs: number;
    renderCount: number;
  }>;
  topComponents: Array<{
    componentId: number;
    name: string;
    renders: number;
    totalSelf: number;
    compiled: boolean;
  }>;
  commitAnomalies: {
    median: number;
    p95: number;
    anomalies: Array<{ commitId: number; timestamp: number; totalSelfTime: number }>;
  };
  reactCompiler: { compiledComponents: number; totalComponents: number };
}

export function buildEvidencePack(store: TraceStore): EvidencePack {
  const instances = store.allInstances();
  const commits = store.commits();
  const anomaly = anomalyStats(commits);
  return {
    stats: store.stats(),
    interactions: store
      .interactions()
      .slice(-10)
      .map((i) => ({
        id: i.id,
        label: i.label,
        kind: i.kind,
        durationMs: round(i.metrics.totalDuration),
        renderCount: i.metrics.renderCount,
      })),
    topComponents: instances
      .map((i) => ({
        componentId: i.id as number,
        name: i.name,
        renders: store.renderCount(i.id),
        totalSelf: round(store.selfTimeTotal(i.id)),
        compiled: i.compiler.compiled,
      }))
      .filter((c) => c.renders > 0)
      .sort((a, b) => b.totalSelf - a.totalSelf)
      .slice(0, 8),
    commitAnomalies: {
      median: round(anomaly.median),
      p95: round(anomaly.p95),
      anomalies: commits
        .filter((c) => anomaly.isAnomaly(c))
        .sort((a, b) => b.totalSelfTime - a.totalSelfTime)
        .slice(0, 5)
        .map((c) => ({
          commitId: c.commitId as number,
          timestamp: round(c.timestamp),
          totalSelfTime: round(c.totalSelfTime),
        })),
    },
    reactCompiler: {
      compiledComponents: instances.filter((i) => i.compiler.compiled).length,
      totalComponents: instances.length,
    },
  };
}

/** Compact fenced block folded into the first user message. */
export function formatEvidencePack(pack: EvidencePack): string {
  if (pack.stats.renders === 0) {
    return [
      "```SESSION EVIDENCE",
      "No renders recorded yet — the user must interact with the page while recording before analysis is possible.",
      "```",
    ].join("\n");
  }
  const lines: string[] = [
    "```SESSION EVIDENCE",
    `stats: ${pack.stats.events} events · ${pack.stats.renders} renders · ${pack.stats.components} components`,
    `react compiler: ${pack.reactCompiler.compiledComponents}/${pack.reactCompiler.totalComponents} components compiled`,
    "interactions (latest first):",
    ...pack.interactions
      .slice()
      .reverse()
      .map((i) => `  [interaction:${i.id}] ${i.label} (${i.kind}) — ${i.durationMs}ms, ${i.renderCount} renders`),
    "top components by self time:",
    ...pack.topComponents.map(
      (c) =>
        `  [component:${c.componentId}] ${c.name} — ${c.renders} renders, ${c.totalSelf}ms total self${c.compiled ? "" : " · uncompiled"}`,
    ),
  ];
  if (pack.commitAnomalies.anomalies.length > 0) {
    lines.push(
      `commit anomalies (median ${pack.commitAnomalies.median}ms, p95 ${pack.commitAnomalies.p95}ms):`,
      ...pack.commitAnomalies.anomalies.map(
        (a) => `  commit ${a.commitId} at ${a.timestamp}ms — ${a.totalSelfTime}ms self time`,
      ),
    );
  }
  lines.push("```");
  return lines.join("\n");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
