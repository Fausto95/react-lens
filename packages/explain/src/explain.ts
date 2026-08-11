import type { ComponentId, RenderEvent } from "@reactlens/protocol";
import type { TraceStore, Interaction } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { Diagnostic } from "@reactlens/diagnostics";
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
  const nextClick = pickNextClick(waste, topCost, doctor, costliest, chain);
  const { headline, summary } = writeCopy(interaction, topCost, waste, chain, doctor, costliest);

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
  const refs: LensRef[] = [{ kind: "interaction", id: interaction.id, label: interaction.label }];
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
  chain: { explanation: string; kind?: string }[],
): NarrativeNextClick | null {
  if (doctor[0]) {
    const fix = doctor[0].fix?.trim();
    return {
      kind: "doctor",
      id: doctor[0].ruleId,
      componentId: doctor[0].componentId,
      reason: fix ? `Next: ${fix}` : `Inspect Doctor finding: ${doctor[0].title}`,
    };
  }
  if (waste[0]) {
    const hint = actionableCauseHint(chain[0]?.explanation);
    return {
      kind: "component",
      id: waste[0].componentId,
      reason: hint
        ? `Stabilize ${hint} feeding ${waste[0].name} (no DOM change)`
        : `Open Why on ${waste[0].name} — find the prop/context that fanned out`,
    };
  }
  if (topCost[0]) {
    if (topCost[0].wasted) {
      return {
        kind: "component",
        id: topCost[0].componentId,
        reason: `Open Why on ${topCost[0].name} — cost with no observable DOM change`,
      };
    }
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

/** Pull a prop/context name out of a causality explanation when present. */
function actionableCauseHint(explanation: string | undefined): string | null {
  if (!explanation) return null;
  const prop =
    explanation.match(/\bprops?\.([A-Za-z_$][\w$]*)/i)?.[1] ??
    explanation
      .match(/\bchanged prop[s]?:\s*([A-Za-z_$][\w$,\s]*)/i)?.[1]
      ?.split(",")[0]
      ?.trim() ??
    explanation.match(/\b(on[A-Z]\w*)\b/)?.[1];
  if (prop) return `prop \`${prop}\``;
  if (/context/i.test(explanation)) {
    const ctx = explanation.match(/context\s+[«"`]?([^»"`\s]+)/i)?.[1];
    return ctx ? `context \`${ctx}\`` : "context value";
  }
  if (/function identity|inline (function|object|array)/i.test(explanation)) {
    return "unstable function/object identity";
  }
  return null;
}

function writeCopy(
  interaction: Interaction,
  topCost: NarrativeCostRow[],
  waste: NarrativeWasteRow[],
  chain: { explanation: string }[],
  doctor: Diagnostic[],
  costliest: RenderEvent | undefined,
): { headline: string; summary: string } {
  const top = topCost[0];
  const sampled = Math.min(WHY_CAP, interaction.metrics.renderCount);
  const wasteShare = sampled > 0 ? Math.round((waste.length / sampled) * 100) : 0;
  const wasteSelf = waste.reduce((s, w) => s + w.self, 0);
  const costSelf = topCost.reduce((s, r) => s + r.self, 0);
  const wasteCostShare = costSelf > 0 ? Math.round((wasteSelf / costSelf) * 100) : 0;

  const mountOnly =
    !!costliest &&
    costliest.reasons.length > 0 &&
    costliest.reasons.every((r) => r.type === "mount");

  let headline = `${interaction.label}: ${interaction.metrics.renderCount} renders`;
  if (waste.length > 0 && wasteShare >= 25) {
    headline = `${interaction.label} — ~${wasteShare}% of sampled renders look avoidable`;
  } else if (top?.wasted) {
    headline = `${interaction.label} — avoidable: ${top.name} (${fmt(top.self)}, no DOM change)`;
  } else if (top && mountOnly && waste.length === 0) {
    headline = `${interaction.label} — expected: ${top.name} mount (${fmt(top.self)})`;
  } else if (top) {
    headline = `${interaction.label} — ${top.name} paid most (${fmt(top.self)})`;
  }

  const parts: string[] = [];
  parts.push(
    `${interaction.kind} ran ${fmt(interaction.metrics.totalDuration)} (React ${fmt(interaction.metrics.reactDuration)}).`,
  );

  if (waste.length > 0) {
    parts.push(
      `Avoidable: ${waste.length} checked render${waste.length === 1 ? "" : "s"} with no observable DOM change` +
        ` (~${wasteShare}% of sampled` +
        (wasteCostShare > 0 ? `, ~${wasteCostShare}% of top self-time` : "") +
        ").",
    );
  } else if (mountOnly && top) {
    parts.push(`Expected: ${top.name} mounted — first-paint cost, not a re-render bug.`);
  } else if (top) {
    parts.push(
      `Top cost: ${top.name} at ${fmt(top.self)} self` + (top.wasted ? " (no DOM change)." : "."),
    );
  }

  if (chain[0]) {
    parts.push(`Likely cause: ${chain[0].explanation}`);
  }
  if (doctor[0]) {
    const fix = doctor[0].fix?.trim();
    parts.push(fix ? `Fix: ${fix}` : `Doctor: ${doctor[0].title}.`);
  } else if (waste[0]) {
    const hint = actionableCauseHint(chain[0]?.explanation);
    parts.push(
      hint
        ? `Next step: stabilize ${hint}.`
        : `Next step: open Why on ${waste[0].name} and fix the fanout owner.`,
    );
  }

  return { headline, summary: parts.join(" ") };
}

function fmt(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  return `${Math.round(ms)}ms`;
}
