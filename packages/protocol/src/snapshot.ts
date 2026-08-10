import type { ComponentId, RenderId } from "./ids.js";
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

export interface RenderSnapshot {
  renderId: RenderId;
  componentId: ComponentId;
  timestamp: number;
  props: SerializedValue;
  state?: SerializedValue;
  context?: SerializedValue;
  hooks?: SerializedValue;
  /** Captured in v1 (DESIGN §6) to prove "no observable output change". */
  dom?: DOMSnapshot;
}
