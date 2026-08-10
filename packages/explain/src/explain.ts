import type { ComponentId, RenderEvent } from "@react-lens/protocol";
import type { TraceStore, Interaction } from "@react-lens/trace-engine";
import type { Causality } from "@react-lens/causality";
import type { Diagnostic } from "@react-lens/diagnostics";
import type {
  LensRef,
  Narrative,
  NarrativeCostRow,
  NarrativeNextClick,
  NarrativeWasteRow,
} from "./types.js";

const TOP_N = 8;
const WHY_CAP = 40;
const DOCTOR_CAP = 6;

export interface ExplainOptions {
  /** Optional Doctor hook — keeps explain free of app-level diagnose wiring. */
  diagnose?: (id: ComponentId) => Diagnostic[];
}

/**
 * Deterministic ranked narrative for one interaction: what fired, who paid,
 * what looked avoidable, top cause chain, one suggested next click.
 */
export function explainInteraction(
  store: TraceStore,
  causality: Causality,
  interaction: Interaction,
  opts: ExplainOptions = {},
): Narrative {
  const renders = interaction.renderIds
    .map((id) => store.getRender(id))
    .filter((r): r is RenderEvent => r != null)
    .sort((a, b) => b.selfDuration - a.selfDuration);

  const topCost: NarrativeCostRow[] = [];
  const waste: NarrativeWasteRow[] = [];
  let whyChecked = 0;

  for (const r of renders) {
    const name = store.instance(r.componentId)?.name ?? `#${r.componentId}`;
    let wasted = false;
    if (whyChecked < WHY_CAP) {
      whyChecked++;
      try {
        wasted = causality.why(r.renderId).verdict === "no-observable-change";
      } catch {
        /* ignore */
      }
    }
    if (topCost.length < TOP_N) {
      topCost.push({
        componentId: r.componentId,
        name,
        self: r.selfDuration,
        renderId: r.renderId,
        wasted,
      });
    }
    if (wasted) {
      waste.push({
        componentId: r.componentId,
        name,
        renderId: r.renderId,
        self: r.selfDuration,
      });
    }
  }

  const costliest = renders[0];
  const chain = costliest ? causality.why(costliest.renderId).causes.slice(0, 3) : [];

  const seenComponents = new Set<ComponentId>();
  const doctor: Diagnostic[] = [];
  if (opts.diagnose) {
    for (const row of topCost) {
      if (seenComponents.has(row.componentId)) continue;
      seenComponents.add(row.componentId);
      for (const d of opts.diagnose(row.componentId)) {
        doctor.push(d);
        if (doctor.length >= DOCTOR_CAP) break;
      }
      if (doctor.length >= DOCTOR_CAP) break;
    }
    doctor.sort((a, b) => b.impact - a.impact);
  }

  const citations = buildCitations(interaction, topCost, waste, doctor);
  const nextClick = pickNextClick(waste, topCost, doctor, costliest);
  const { headline, summary } = writeCopy(interaction, topCost, waste, chain, doctor);

  return {
    interactionId: interaction.id,
    label: interaction.label,
    kind: interaction.kind,
    durationMs: interaction.metrics.totalDuration,
    reactMs: interaction.metrics.reactDuration,
    renderCount: interaction.metrics.renderCount,
    headline,
    summary,
    topCost,
    waste: waste.slice(0, TOP_N),
    chain,
    doctor: doctor.slice(0, DOCTOR_CAP),
    nextClick,
    citations,
  };
}

function buildCitations(
  interaction: Interaction,
  topCost: NarrativeCostRow[],
  waste: NarrativeWasteRow[],
  doctor: Diagnostic[],
): LensRef[] {
  const refs: LensRef[] = [
    { kind: "interaction", id: interaction.id, label: interaction.label },
  ];
  for (const row of topCost.slice(0, 5)) {
    refs.push({
      kind: "component",
      id: row.componentId,
      label: row.name,
    });
    refs.push({
      kind: "render",
      id: row.renderId,
      label: `${row.name} @ ${row.self.toFixed(2)}ms`,
      componentId: row.componentId,
    });
  }
  for (const w of waste.slice(0, 3)) {
    if (refs.some((r) => r.kind === "render" && r.id === w.renderId)) continue;
    refs.push({
      kind: "render",
      id: w.renderId,
      label: `${w.name} (no visible change)`,
      componentId: w.componentId,
    });
  }
  for (const d of doctor.slice(0, 3)) {
    refs.push({
      kind: "doctor",
      ruleId: d.ruleId,
      componentId: d.componentId,
      label: d.title,
    });
  }
  return refs;
}

function pickNextClick(
  waste: NarrativeWasteRow[],
  topCost: NarrativeCostRow[],
  doctor: Diagnostic[],
  costliest: RenderEvent | undefined,
): NarrativeNextClick | null {
  if (doctor[0]) {
    return {
      kind: "doctor",
      id: doctor[0].ruleId,
      componentId: doctor[0].componentId,
      reason: `Inspect Doctor finding: ${doctor[0].title}`,
    };
  }
  if (waste[0]) {
    return {
      kind: "component",
      id: waste[0].componentId,
      reason: `Inspect ${waste[0].name} — rendered with no observable DOM change`,
    };
  }
  if (topCost[0]) {
    return {
      kind: "component",
      id: topCost[0].componentId,
      reason: `Inspect ${topCost[0].name} — highest self time in this interaction`,
    };
  }
  if (costliest) {
    return {
      kind: "render",
      id: costliest.renderId,
      componentId: costliest.componentId,
      reason: "Open Why for the costliest render",
    };
  }
  return null;
}

function writeCopy(
  interaction: Interaction,
  topCost: NarrativeCostRow[],
  waste: NarrativeWasteRow[],
  chain: { explanation: string }[],
  doctor: Diagnostic[],
): { headline: string; summary: string } {
  const top = topCost[0];
  const wasteShare =
    interaction.metrics.renderCount > 0
      ? Math.round((waste.length / Math.min(WHY_CAP, interaction.metrics.renderCount)) * 100)
      : 0;

  let headline = `${interaction.label}: ${interaction.metrics.renderCount} renders`;
  if (top) {
    headline = `${interaction.label} — ${top.name} paid most (${fmt(top.self)})`;
  }

  const parts: string[] = [];
  parts.push(
    `${interaction.kind} ran ${fmt(interaction.metrics.totalDuration)} (React ${fmt(interaction.metrics.reactDuration)}).`,
  );
  if (top) {
    parts.push(`Top cost: ${top.name} at ${fmt(top.self)} self.`);
  }
  if (waste.length > 0) {
    parts.push(
      `${waste.length} checked render${waste.length === 1 ? "" : "s"} produced no observable DOM change${wasteShare ? ` (~${wasteShare}% of sampled)` : ""}.`,
    );
  }
  if (chain[0]) {
    parts.push(`Likely cause: ${chain[0].explanation}`);
  }
  if (doctor[0]) {
    parts.push(`Doctor: ${doctor[0].title}.`);
  }

  return { headline, summary: parts.join(" ") };
}

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}
