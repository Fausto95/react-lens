import type {
  EventsBatchMessage,
  RenderId,
  ComponentId,
  TimeTravelEntry,
} from "@react-lens/protocol";

/** Envelope for page(MAIN) ↔ content(ISOLATED) hops over window.postMessage. */
export const PAGE_SOURCE = "react-lens/page";
export const CONTENT_SOURCE = "react-lens/content";

/** JSON-safe edit values (postMessage). */
export type EditPrimitive = string | number | boolean | null;

export type PageToContent =
  | { source: typeof PAGE_SOURCE; kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { source: typeof PAGE_SOURCE; kind: "hello"; reactVersion: string | null }
  | { source: typeof PAGE_SOURCE; kind: "snapshot"; frame: EventsBatchMessage["payload"] }
  | {
      source: typeof PAGE_SOURCE;
      kind: "source";
      requestId: string;
      url: string;
      body?: string;
      error?: string;
    }
  /** Inspect mode: user clicked a DOM node mapped to a component. */
  | {
      source: typeof PAGE_SOURCE;
      kind: "inspect-picked";
      componentId: ComponentId;
      name: string;
      sourceFile?: string;
      sourceLine?: number;
    }
  /** Result of an inline text edit attempt. */
  | {
      source: typeof PAGE_SOURCE;
      kind: "edit-result";
      requestId: string;
      ok: boolean;
      mode?: "react" | "dom";
      error?: string;
    }
  /** Ack for a time-travel apply/go-live (entry ids are JSON-safe numbers). */
  | {
      source: typeof PAGE_SOURCE;
      kind: "time-travel-result";
      requestId: string;
      applied: number;
      failed: number;
      supported: boolean;
    };

export type ContentToPage =
  | { source: typeof CONTENT_SOURCE; kind: "record"; recording: boolean }
  | { source: typeof CONTENT_SOURCE; kind: "snapshot-request"; renderId: RenderId }
  | { source: typeof CONTENT_SOURCE; kind: "source-request"; requestId: string; url: string }
  | { source: typeof CONTENT_SOURCE; kind: "highlight"; componentId: ComponentId | null }
  | { source: typeof CONTENT_SOURCE; kind: "replay"; componentIds: ComponentId[] }
  | { source: typeof CONTENT_SOURCE; kind: "inspect-start" }
  | { source: typeof CONTENT_SOURCE; kind: "inspect-stop" }
  | {
      source: typeof CONTENT_SOURCE;
      kind: "edit-setProp";
      requestId: string;
      componentId: ComponentId;
      path: Array<string | number>;
      value: EditPrimitive;
    }
  | {
      source: typeof CONTENT_SOURCE;
      kind: "edit-setHookState";
      requestId: string;
      componentId: ComponentId;
      hookIndex: number;
      path: Array<string | number>;
      value: EditPrimitive;
    }
  | {
      source: typeof CONTENT_SOURCE;
      kind: "edit-setText";
      requestId: string;
      componentId: ComponentId;
      text: string;
    }
  /** Restore each entry's captured state at its renderId (raw values stay page-side). */
  | {
      source: typeof CONTENT_SOURCE;
      kind: "time-travel-apply";
      requestId: string;
      entries: TimeTravelEntry[];
    }
  | { source: typeof CONTENT_SOURCE; kind: "time-travel-live"; requestId: string };

/** Port protocol for content ↔ background ↔ panel hops. */
export type PortMessage =
  | { kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { kind: "hello"; reactVersion: string | null }
  | { kind: "record"; recording: boolean }
  | { kind: "panel-ready" }
  | { kind: "snapshot-request"; renderId: RenderId }
  | { kind: "snapshot"; frame: EventsBatchMessage["payload"] }
  | { kind: "source-request"; requestId: string; url: string }
  | { kind: "source"; requestId: string; url: string; body?: string; error?: string }
  | { kind: "highlight"; componentId: ComponentId | null }
  | { kind: "replay"; componentIds: ComponentId[] }
  | { kind: "inspect-start" }
  | { kind: "inspect-stop" }
  | {
      kind: "inspect-picked";
      componentId: ComponentId;
      name: string;
      sourceFile?: string;
      sourceLine?: number;
    }
  | {
      kind: "edit-setProp";
      requestId: string;
      componentId: ComponentId;
      path: Array<string | number>;
      value: EditPrimitive;
    }
  | {
      kind: "edit-setHookState";
      requestId: string;
      componentId: ComponentId;
      hookIndex: number;
      path: Array<string | number>;
      value: EditPrimitive;
    }
  | {
      kind: "edit-setText";
      requestId: string;
      componentId: ComponentId;
      text: string;
    }
  | {
      kind: "edit-result";
      requestId: string;
      ok: boolean;
      mode?: "react" | "dom";
      error?: string;
    }
  | { kind: "time-travel-apply"; requestId: string; entries: TimeTravelEntry[] }
  | { kind: "time-travel-live"; requestId: string }
  | {
      kind: "time-travel-result";
      requestId: string;
      applied: number;
      failed: number;
      supported: boolean;
    };

export const PANEL_PORT_PREFIX = "react-lens/panel:";
export const PAGE_PORT_NAME = "react-lens/page";
