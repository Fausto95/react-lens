import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality, WhyResult } from "@reactlens/causality";
import type {
  ComponentId,
  CommitId,
  EffectEvent,
  RenderEvent,
  RenderReason,
} from "@reactlens/protocol";
import {
  analyze,
  analyzeOne,
  type Diagnostic,
  type DiagnosticInput,
  type LatestRenderEvidence,
} from "@reactlens/diagnostics";

/**
 * Per-pass cache so diagnoseAll does not walk the event log or parent tree
 * once per component. Built from the trace the panel already owns — no second
 * React internals hook, no bippy.
 */
interface DoctorContext {
  latestCommitId: CommitId | null;
  cascadeByComponent: Map<ComponentId, number>;
  effectsByComponent: Map<ComponentId, EffectEvent[]>;
}

function buildDoctorContext(store: TraceStore): DoctorContext {
  const latestCommitId = store.commits().at(-1)?.commitId ?? null;
  return {
    latestCommitId,
    cascadeByComponent: latestCommitId ? descendantRenderCounts(store, latestCommitId) : new Map(),
    effectsByComponent: groupEffects(store),
  };
}

/** Assemble the runtime evidence Doctor rules consume for one component. */
export function buildDiagnosticInput(
  store: TraceStore,
  causality: Causality,
  id: ComponentId,
  ctx: DoctorContext = buildDoctorContext(store),
): DiagnosticInput | null {
  const inst = store.instance(id);
  if (!inst) return null;
  const renders = store.rendersOf(id);
  if (renders.length === 0) return null;

  let suspicious = 0;
  for (const r of renders) {
    try {
      if (causality.why(r.renderId).verdict === "no-observable-change") suspicious++;
    } catch {
      /* ignore */
    }
  }

  const last = renders.at(-1)!;
  const latest =
    ctx.latestCommitId != null && last.commitId === ctx.latestCommitId
      ? latestEvidence(store, causality, last, ctx)
      : undefined;

  return {
    componentId: id,
    name: inst.name,
    renders: store.renderCount(id),
    suspiciousRenders: suspicious,
    selfTime: store.selfTimeTotal(id),
    functionPropChurn: hasFunctionPropChurn(causality, last),
    uncompiled: !inst.compiler.compiled,
    ...(latest ? { latest } : {}),
    ...(inst.source ? { source: inst.source } : {}),
  };
}

function latestEvidence(
  store: TraceStore,
  causality: Causality,
  last: RenderEvent,
  ctx: DoctorContext,
): LatestRenderEvidence {
  let wasted = false;
  let why: WhyResult | null = null;
  try {
    why = causality.why(last.renderId);
    wasted = why.verdict === "no-observable-change";
  } catch {
    /* ignore */
  }

  const ownValueChanged = why ? hasOwnValueChange(why) : false;
  const identityKeys = why ? referenceOnlyKeys(why) : [];
  const types = last.reasons.map((r) => r.type);
  const ownReason = types.some(
    (t) =>
      t === "props" ||
      t === "state" ||
      t === "context" ||
      t === "external-store" ||
      t === "force-update" ||
      t === "mount",
  );
  const bailout = last.reasons.find((r) => r.type === "compiler-bailout");
  const compilerBailout =
    (bailout?.type === "compiler-bailout" ? bailout.reason : null) ??
    last.compiler.bailoutReason ??
    null;
  const { ms: effectMs, lines: effectLines } = effectHits(
    ctx.effectsByComponent.get(last.componentId),
    last,
  );

  return {
    wasted,
    identityKeys,
    compilerBailout,
    contextUpdate: types.includes("context"),
    parentOnly: types.includes("parent") && !ownReason && !ownValueChanged,
    externalStore: types.includes("external-store"),
    forceUpdate: types.includes("force-update"),
    effectMs,
    renderMs: last.selfDuration,
    cascadeSize: ctx.cascadeByComponent.get(last.componentId) ?? 0,
    reasonSummary: summarizeReasons(store, last),
    ownValueChanged,
    effectLines,
  };
}

function hasFunctionPropChurn(causality: Causality, last: RenderEvent): boolean {
  try {
    const why = causality.why(last.renderId);
    return why.causes.some((c) => {
      if (!c.diff) return false;
      const changes = c.diff.changes;
      const fn = changes.some((ch) => ch.kind === "FUNCTION_IDENTITY_CHANGED");
      const value = changes.some((ch) => ch.kind === "VALUE_CHANGED");
      return fn && !value;
    });
  } catch {
    return false;
  }
}

function hasOwnValueChange(why: WhyResult): boolean {
  return why.causes.some((c) =>
    c.diff?.changes.some(
      (ch) => ch.kind === "VALUE_CHANGED" || ch.kind === "ADDED" || ch.kind === "REMOVED",
    ),
  );
}

function referenceOnlyKeys(why: WhyResult): string[] {
  const keys: string[] = [];
  for (const c of why.causes) {
    if (!c.diff) continue;
    for (const ch of c.diff.changes) {
      if (ch.kind !== "REFERENCE_ONLY_CHANGED") continue;
      const key = ch.path.length > 0 ? String(ch.path[0]) : "value";
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function summarizeReasons(store: TraceStore, render: RenderEvent): string {
  if (render.reasons.length === 0) return "React did not report a specific render reason.";
  return render.reasons.map((reason) => reasonLabel(store, reason)).join(" · ");
}

function reasonLabel(store: TraceStore, reason: RenderReason): string {
  switch (reason.type) {
    case "mount":
      return "mounted";
    case "props":
      return reason.changed.length > 0
        ? `props changed: ${reason.changed.join(", ")}`
        : "props changed";
    case "state":
      return `state hook #${reason.hookIndex} changed`;
    case "context":
      return "consumed context changed";
    case "parent":
      return `parent ${store.instance(reason.componentId)?.name ?? `#${reason.componentId}`} rendered`;
    case "external-store":
      return "external store invalidated subscription";
    case "force-update":
      return "forceUpdate";
    case "compiler-bailout":
      return `compiler bailout: ${reason.reason}`;
  }
}

function formatMs(value: number): string {
  if (value <= 0) return "0ms";
  if (value < 0.1) return `${value.toFixed(2)}ms`;
  if (value < 10) return `${value.toFixed(1)}ms`;
  return `${Math.round(value)}ms`;
}

function effectHits(
  effects: EffectEvent[] | undefined,
  render: RenderEvent,
): { ms: number; lines: string[] } {
  if (!effects || effects.length === 0) return { ms: 0, lines: [] };
  const hi = render.timestamp + Math.max(render.totalDuration, 1) + 16;
  let ms = 0;
  const lines: string[] = [];
  for (const e of effects) {
    if (e.timestamp < render.timestamp || e.timestamp > hi) continue;
    ms += e.duration;
    if (lines.length < 4) {
      lines.push(
        `${e.phase}${e.hookIndex !== undefined ? ` · hook #${e.hookIndex}` : ""} · ${formatMs(e.duration)}`,
      );
    }
  }
  return { ms, lines };
}

/**
 * Transitive count of same-commit descendants, walking parentId through
 * ancestors that also rendered. Matches Cascade's cascade-size idea without
 * importing the graph overlay.
 */
function descendantRenderCounts(store: TraceStore, commitId: CommitId): Map<ComponentId, number> {
  const commit = store.commit(commitId);
  const counts = new Map<ComponentId, number>();
  if (!commit) return counts;
  const rendered = new Set(commit.componentIds);
  for (const id of commit.componentIds) counts.set(id, 0);
  for (const id of commit.componentIds) {
    const seen = new Set<ComponentId>();
    let cur = store.instance(id);
    while (cur?.parentId != null && !seen.has(cur.parentId)) {
      const parentId = cur.parentId;
      seen.add(parentId);
      if (rendered.has(parentId)) {
        counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
      }
      cur = store.instance(parentId);
    }
  }
  return counts;
}

function groupEffects(store: TraceStore): Map<ComponentId, EffectEvent[]> {
  const map = new Map<ComponentId, EffectEvent[]>();
  for (const e of store.allEvents()) {
    if (e.type !== "effect" || e.componentId == null) continue;
    const list = map.get(e.componentId);
    if (list) list.push(e);
    else map.set(e.componentId, [e]);
  }
  return map;
}

export function diagnoseOne(
  store: TraceStore,
  causality: Causality,
  id: ComponentId,
): Diagnostic[] {
  const input = buildDiagnosticInput(store, causality, id);
  return input ? analyzeOne(input) : [];
}

export function diagnoseAll(
  store: TraceStore,
  causality: Causality,
): { diagnostics: Diagnostic[]; affected: Set<ComponentId> } {
  const ctx = buildDoctorContext(store);
  const inputs: DiagnosticInput[] = [];
  for (const inst of store.allInstances()) {
    if (store.renderCount(inst.id) === 0) continue;
    const input = buildDiagnosticInput(store, causality, inst.id, ctx);
    if (input) inputs.push(input);
  }
  const diagnostics = analyze(inputs);
  return { diagnostics, affected: new Set(diagnostics.map((d) => d.componentId)) };
}

/** Default diagnose callback for hosts that don't customize Doctor. */
export function createDefaultDiagnose(
  store: TraceStore,
  causality: Causality,
): (id: ComponentId) => Diagnostic[] {
  return (id) => diagnoseOne(store, causality, id);
}
