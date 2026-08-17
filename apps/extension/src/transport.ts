import type {
  EventsBatchMessage,
  RenderId,
  ComponentId,
  TimeTravelEntry,
  TimeTravelResult,
} from "@reactlens/protocol";

/** Envelope for page(MAIN) ↔ content(ISOLATED) hops over window.postMessage. */
export const PAGE_SOURCE = "react-lens/page";
export const CONTENT_SOURCE = "react-lens/content";

/** JSON-safe edit values (postMessage). */
export type EditPrimitive = string | number | boolean | null;

export type PageToContent =
  | {
      source: typeof PAGE_SOURCE;
      kind: "frame";
      frame: EventsBatchMessage["payload"];
      sessionId: string;
    }
  | {
      source: typeof PAGE_SOURCE;
      kind: "hello";
      reactVersion: string | null;
      sessionId: string;
      /** Capture agent protocol; panel rejects a mismatch instead of corrupting. */
      protocolVersion: number;
    }
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
  /** Where a component is defined inside the shipped bundle (production builds). */
  | {
      source: typeof PAGE_SOURCE;
      kind: "locate-source-result";
      requestId: string;
      componentId: ComponentId;
      file?: string;
      line?: number;
      column?: number;
    }
  /** Ack for a time-travel apply/go-live (entry ids are JSON-safe numbers). */
  | ({
      source: typeof PAGE_SOURCE;
      kind: "time-travel-result";
      requestId: string;
    } & TimeTravelResult);

export type ContentToPage =
  | { source: typeof CONTENT_SOURCE; kind: "record"; recording: boolean }
  | { source: typeof CONTENT_SOURCE; kind: "snapshot-request"; renderId: RenderId }
  | { source: typeof CONTENT_SOURCE; kind: "source-request"; requestId: string; url: string }
  | {
      source: typeof CONTENT_SOURCE;
      kind: "highlight";
      componentId: ComponentId | null;
      /** Also scroll the page to the component when it's out of view. */
      reveal?: boolean;
    }
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
      /** Cursor time — lets the page rewind registered store adapters too. */
      atT?: number;
    }
  | { source: typeof CONTENT_SOURCE; kind: "time-travel-live"; requestId: string }
  | {
      source: typeof CONTENT_SOURCE;
      kind: "locate-source";
      requestId: string;
      componentId: ComponentId;
    };

/**
 * Port protocol for content ↔ background ↔ panel hops.
 *
 * `frame` and `hello` form one ordered, resumable stream. The page stamps them
 * with a per-document `sessionId` (its id factories restart at 1 on every load,
 * so the panel must know when to start over) and the content script's durable
 * buffer stamps the delivery cursor `seq`.
 */
export type PortMessage =
  | { kind: "frame"; frame: EventsBatchMessage["payload"]; sessionId: string; seq: number }
  | {
      kind: "hello";
      reactVersion: string | null;
      sessionId: string;
      seq: number;
      protocolVersion: number;
    }
  | { kind: "record"; recording: boolean }
  /** Panel → page: replay everything after `fromSeq` of `sessionId`. */
  | { kind: "panel-ready"; sessionId: string | null; fromSeq: number }
  /**
   * Panel → page: everything up to `seq` is durably kept, so the page-side
   * buffer can forget it. This is what stops the buffer overflowing at all.
   */
  | { kind: "ack"; sessionId: string; seq: number }
  /**
   * Page → panel: this range could not be retained anywhere (memory full, then
   * storage quota full). The panel says so rather than showing a gapless
   * timeline with a hole in it.
   */
  | { kind: "compacted"; sessionId: string; fromSeq: number; toSeq: number; frames: number }
  /** Liveness probe. Answered by the immediate peer, never relayed onward. */
  | { kind: "ping"; id: number }
  | { kind: "pong"; id: number }
  /** Background → panel: a page port is live again; ask it for a replay. */
  | { kind: "page-connected" }
  | { kind: "snapshot-request"; renderId: RenderId }
  | { kind: "snapshot"; frame: EventsBatchMessage["payload"] }
  | { kind: "source-request"; requestId: string; url: string }
  | { kind: "source"; requestId: string; url: string; body?: string; error?: string }
  | { kind: "highlight"; componentId: ComponentId | null; reveal?: boolean }
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
  | { kind: "locate-source"; requestId: string; componentId: ComponentId }
  | {
      kind: "locate-source-result";
      requestId: string;
      componentId: ComponentId;
      file?: string;
      line?: number;
      column?: number;
    }
  | { kind: "time-travel-apply"; requestId: string; entries: TimeTravelEntry[]; atT?: number }
  | { kind: "time-travel-live"; requestId: string }
  | ({ kind: "time-travel-result"; requestId: string } & TimeTravelResult);

/** The resumable half of the protocol — everything else is request/response. */
export type SequencedMessage = Extract<PortMessage, { kind: "frame" | "hello" }>;

/** A sequenced message as the page emits it, before the buffer stamps a seq. */
export type Unsequenced<T> = T extends unknown ? Omit<T, "seq"> : never;

export const PANEL_PORT_PREFIX = "react-lens/panel:";
export const PAGE_PORT_NAME = "react-lens/page";
