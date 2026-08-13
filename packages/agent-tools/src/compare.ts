import type { EventsBatchMessage, RenderId } from "@reactlens/protocol";
import { TraceStore } from "@reactlens/trace-engine";
import { createCausality, type Causality } from "@reactlens/causality";

export interface InteractionDelta {
  name: string;
  beforeRenderCount: number;
  afterRenderCount: number;
  renderDelta: number;
  renderDeltaPct: number;
  beforeWaste: number;
  afterWaste: number;
  wasteDelta: number;
}

export interface CompareSessionsResult {
  verdict: string;
  regressions: InteractionDelta[];
  improvements: InteractionDelta[];
  matched: InteractionDelta[];
  onlyBefore: string[];
  onlyAfter: string[];
}

function wasteCount(store: TraceStore, causality: Causality): Map<string, number> {
  const out = new Map<string, number>();
  for (const inst of store.allInstances()) {
    for (const r of store.rendersOf(inst.id)) {
      try {
        if (causality.why(r.renderId).verdict !== "no-observable-change") continue;
        const key = interactionKeyForRender(store, r.renderId);
        out.set(key, (out.get(key) ?? 0) + 1);
      } catch {
        /* skip evicted render */
      }
    }
  }
  return out;
}

function interactionKeyForRender(store: TraceStore, renderId: RenderId): string {
  for (const it of store.interactions()) {
    if (it.renderIds.includes(renderId)) return it.label;
  }
  return "unknown";
}

function interactionMap(store: TraceStore): Map<string, { renderCount: number }> {
  const map = new Map<string, { renderCount: number }>();
  for (const it of store.interactions()) {
    map.set(it.label, { renderCount: it.metrics.renderCount });
  }
  return map;
}

/** Compare two session payloads keyed by interaction label/name. */
export function compareSessions(
  beforePayload: EventsBatchMessage["payload"],
  afterPayload: EventsBatchMessage["payload"],
): CompareSessionsResult {
  const beforeStore = new TraceStore();
  const afterStore = new TraceStore();
  beforeStore.ingest(beforePayload);
  afterStore.ingest(afterPayload);
  const beforeCausality = createCausality(beforeStore);
  const afterCausality = createCausality(afterStore);

  const before = interactionMap(beforeStore);
  const after = interactionMap(afterStore);
  const beforeWaste = wasteCount(beforeStore, beforeCausality);
  const afterWaste = wasteCount(afterStore, afterCausality);

  const names = new Set([...before.keys(), ...after.keys()]);
  const regressions: InteractionDelta[] = [];
  const improvements: InteractionDelta[] = [];
  const matched: InteractionDelta[] = [];
  const onlyBefore: string[] = [];
  const onlyAfter: string[] = [];

  for (const name of names) {
    const b = before.get(name);
    const a = after.get(name);
    if (!b) {
      onlyAfter.push(name);
      continue;
    }
    if (!a) {
      onlyBefore.push(name);
      continue;
    }
    const bw = beforeWaste.get(name) ?? 0;
    const aw = afterWaste.get(name) ?? 0;
    const renderDelta = a.renderCount - b.renderCount;
    const renderDeltaPct = b.renderCount > 0 ? (renderDelta / b.renderCount) * 100 : 0;
    const delta: InteractionDelta = {
      name,
      beforeRenderCount: b.renderCount,
      afterRenderCount: a.renderCount,
      renderDelta,
      renderDeltaPct: Math.round(renderDeltaPct * 100) / 100,
      beforeWaste: bw,
      afterWaste: aw,
      wasteDelta: aw - bw,
    };
    matched.push(delta);
    const renderRegression = renderDeltaPct > 20;
    const wasteRegression = aw > 0 && aw > bw;
    if (renderRegression || wasteRegression) regressions.push(delta);
    else if (renderDelta < 0 || aw < bw) improvements.push(delta);
  }

  const verdict =
    regressions.length === 0
      ? matched.length === 0
        ? "No matching interactions to compare."
        : `No regressions across ${matched.length} matched interaction(s).`
      : `${regressions.length} regression(s): ${regressions.map((r) => r.name).join(", ")}`;

  return { verdict, regressions, improvements, matched, onlyBefore, onlyAfter };
}

export function sessionStats(payload: EventsBatchMessage["payload"]): {
  events: number;
  renders: number;
  components: number;
  waste: number;
} {
  const store = new TraceStore();
  store.ingest(payload);
  const causality = createCausality(store);
  let waste = 0;
  for (const inst of store.allInstances()) {
    for (const r of store.rendersOf(inst.id)) {
      try {
        if (causality.why(r.renderId).verdict === "no-observable-change") waste++;
      } catch {
        /* skip */
      }
    }
  }
  const stats = store.stats();
  return { events: stats.events, renders: stats.renders, components: stats.components, waste };
}
