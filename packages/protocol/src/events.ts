import type {
  ComponentId,
  ComponentType,
  EventId,
  InteractionId,
  RenderId,
  CommitId,
  EffectId,
} from "./ids.js";
import type { SerializedValue } from "./value.js";
import type { CompilerStatus, SourceLocation } from "./component.js";

export interface BaseEvent {
  id: EventId;
  /** performance.now() on the page clock. */
  timestamp: number;
  componentId?: ComponentId;
  interactionId?: InteractionId;
  /** Reconstructed by the causality package; absent at capture time. */
  causedBy?: EventId[];
}

export type RenderReason =
  | { type: "mount" }
  | { type: "props"; changed: string[] }
  | { type: "state"; hookIndex: number }
  | { type: "context"; contextType: ComponentType }
  | { type: "parent"; componentId: ComponentId }
  | { type: "external-store" }
  | { type: "force-update" }
  | { type: "compiler-bailout"; reason: string };

export interface RenderEvent extends BaseEvent {
  type: "render";
  renderId: RenderId;
  commitId: CommitId;
  componentId: ComponentId;
  selfDuration: number;
  totalDuration: number;
  reasons: RenderReason[];
  compiler: CompilerStatus;
}

export interface InteractionEvent extends BaseEvent {
  type: "interaction";
  interactionId: InteractionId;
  kind: "click" | "keypress" | "submit" | "navigation" | "hover" | "drag" | "transition";
  target?: { selector: string; componentId?: ComponentId };
}

export interface StateChangeEvent extends BaseEvent {
  type: "state-change";
  componentId: ComponentId;
  hookIndex: number;
  before: SerializedValue;
  after: SerializedValue;
}

export interface PropsChangeEvent extends BaseEvent {
  type: "props-change";
  componentId: ComponentId;
  before: SerializedValue;
  after: SerializedValue;
}

export interface ContextChangeEvent extends BaseEvent {
  type: "context-change";
  contextType: ComponentType;
  before: SerializedValue;
  after: SerializedValue;
}

export interface EffectEvent extends BaseEvent {
  type: "effect";
  effectId: EffectId;
  componentId: ComponentId;
  phase: "run" | "cleanup";
  duration: number;
  source?: SourceLocation;
}

export interface DiagnosticEvent extends BaseEvent {
  type: "diagnostic";
  ruleId: string;
  message: string;
}

export type LensEvent =
  | RenderEvent
  | InteractionEvent
  | StateChangeEvent
  | PropsChangeEvent
  | ContextChangeEvent
  | EffectEvent
  | DiagnosticEvent;

export type LensEventType = LensEvent["type"];
