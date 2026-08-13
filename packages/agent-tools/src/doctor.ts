import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId } from "@reactlens/protocol";
import { analyze, analyzeOne, type Diagnostic, type DiagnosticInput } from "@reactlens/diagnostics";

/** Assemble the runtime evidence Doctor rules consume for one component. */
export function buildDiagnosticInput(
  store: TraceStore,
  causality: Causality,
  id: ComponentId,
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

  return {
    componentId: id,
    name: inst.name,
    renders: store.renderCount(id),
    suspiciousRenders: suspicious,
    selfTime: store.selfTimeTotal(id),
    functionPropChurn: hasFunctionPropChurn(store, causality, id),
    uncompiled: !inst.compiler.compiled,
    ...(inst.source ? { source: inst.source } : {}),
  };
}

function hasFunctionPropChurn(store: TraceStore, causality: Causality, id: ComponentId): boolean {
  const last = store.rendersOf(id).at(-1);
  if (!last) return false;
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
  const inputs: DiagnosticInput[] = [];
  for (const inst of store.allInstances()) {
    if (store.renderCount(inst.id) === 0) continue;
    const input = buildDiagnosticInput(store, causality, inst.id);
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
