import type { TraceStore } from "@reactlens/trace-engine";
import type { Causality } from "@reactlens/causality";
import type { ComponentId } from "@reactlens/protocol";
import type { Diagnostic } from "@reactlens/diagnostics";
import {
  buildDiagnosticInput,
  diagnoseOne as diagnoseOneShared,
  diagnoseAll as diagnoseAllShared,
} from "@reactlens/agent-tools";

/** Assemble the runtime evidence the Doctor rules consume for one component. */
export function buildInput(
  store: TraceStore,
  causality: Causality,
  id: ComponentId,
): ReturnType<typeof buildDiagnosticInput> {
  return buildDiagnosticInput(store, causality, id);
}

export function diagnoseOne(
  store: TraceStore,
  causality: Causality,
  id: ComponentId,
): Diagnostic[] {
  return diagnoseOneShared(store, causality, id);
}

/** All diagnostics across captured components, ranked; plus the affected set. */
export function diagnoseAll(
  store: TraceStore,
  causality: Causality,
): { diagnostics: Diagnostic[]; affected: Set<ComponentId> } {
  return diagnoseAllShared(store, causality);
}
