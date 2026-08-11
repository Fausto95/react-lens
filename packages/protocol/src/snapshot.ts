import type { CommitId, ComponentId, ComponentType, RenderId } from "./ids.js";
import type { SerializedValue } from "./value.js";

export interface DOMNodeSnapshot {
  nodeName: string;
  attributes?: Record<string, string>;
  text?: string;
  children?: DOMNodeSnapshot[];
}

export interface DOMSnapshot {
  root: DOMNodeSnapshot;
}

/**
 * Whole-page DOM at a commit, throttled — the offline playback substrate.
 * Imported sessions cannot restore live state, but they can show what the
 * page looked like at the cursor.
 */
export interface CommitSnapshot {
  commitId: CommitId;
  timestamp: number;
  dom: DOMSnapshot;
}

export type HookKind =
  | "state"
  | "reducer"
  | "effect"
  | "layout-effect"
  | "memo"
  | "callback"
  | "ref"
  | "context"
  | "transition"
  | "deferred"
  | "other";

/**
 * A single hook, classified heuristically from the fiber's hook list. Types are
 * inferred from the memoizedState shape (React does not tag them), so `kind`
 * carries some uncertainty — surfaced honestly in the UI.
 */
export interface HookSnapshot {
  index: number;
  kind: HookKind;
  value?: SerializedValue;
  /** Effect/memo/callback dependency array, or null for "no deps". */
  deps?: SerializedValue[] | null;
}

export interface ContextSnapshot {
  contextType?: ComponentType;
  displayName?: string;
  value: SerializedValue;
}

export interface RenderSnapshot {
  renderId: RenderId;
  componentId: ComponentId;
  timestamp: number;
  props: SerializedValue;
  /** Combined serialized state, for diffing (causality). */
  state?: SerializedValue;
  /** Combined serialized context, for diffing (causality). */
  context?: SerializedValue;
  /** Structured per-hook detail for the Hooks/State/Effects inspector tabs. */
  hooks?: HookSnapshot[];
  /** Consumed contexts with current values for the Context tab. */
  contexts?: ContextSnapshot[];
  /** Captured in v1 (DESIGN §6) to prove "no observable output change". */
  dom?: DOMSnapshot;
}
