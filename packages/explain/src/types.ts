import type { ComponentId, RenderId } from "@reactlens/protocol";
import type { Diagnostic } from "@reactlens/diagnostics";
import type { Cause } from "@reactlens/causality";

/** Citation into Lens IDs — UI jumps Timeline / Tree / Why / Doctor from these. */
export type LensRef =
  | { kind: "interaction"; id: string; label: string }
  | { kind: "component"; id: ComponentId; label: string }
  | { kind: "render"; id: RenderId; label: string; componentId: ComponentId }
  | { kind: "doctor"; ruleId: string; componentId: ComponentId; label: string };

export interface NarrativeCostRow {
  componentId: ComponentId;
  name: string;
  self: number;
  renderId: RenderId;
  wasted: boolean;
}

export interface NarrativeWasteRow {
  componentId: ComponentId;
  name: string;
  renderId: RenderId;
  self: number;
}

export interface NarrativeNextClick {
  kind: "component" | "render" | "doctor";
  id: ComponentId | RenderId | string;
  componentId?: ComponentId;
  reason: string;
}

export interface Narrative {
  interactionId: string;
  label: string;
  kind: string;
  durationMs: number;
  reactMs: number;
  renderCount: number;
  headline: string;
  summary: string;
  topCost: NarrativeCostRow[];
  waste: NarrativeWasteRow[];
  chain: Cause[];
  doctor: Diagnostic[];
  nextClick: NarrativeNextClick | null;
  citations: LensRef[];
}
