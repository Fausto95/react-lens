import type { EventsBatchMessage, RenderId } from "@react-lens/protocol";

/** Envelope for page(MAIN) ↔ content(ISOLATED) hops over window.postMessage. */
export const PAGE_SOURCE = "react-lens/page";
export const CONTENT_SOURCE = "react-lens/content";

export type PageToContent =
  | { source: typeof PAGE_SOURCE; kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { source: typeof PAGE_SOURCE; kind: "hello"; reactVersion: string | null }
  // Response to a snapshot-request: not buffered, relayed straight through.
  | { source: typeof PAGE_SOURCE; kind: "snapshot"; frame: EventsBatchMessage["payload"] };

export type ContentToPage =
  | { source: typeof CONTENT_SOURCE; kind: "record"; recording: boolean }
  // Panel asked for the heavy snapshot of a specific render (built lazily,
  // since snapshots aren't streamed inline for large apps).
  | { source: typeof CONTENT_SOURCE; kind: "snapshot-request"; renderId: RenderId };

/** Port protocol for content ↔ background ↔ panel hops. */
export type PortMessage =
  | { kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { kind: "hello"; reactVersion: string | null }
  | { kind: "record"; recording: boolean }
  // background → content: a panel is now listening, so replay the durable
  // buffer. Sent whenever a panel pairs with the page, so it survives
  // service-worker restarts (the content script and its buffer outlive them).
  | { kind: "panel-ready" }
  // panel → page: fetch one render's heavy snapshot on demand.
  | { kind: "snapshot-request"; renderId: RenderId }
  // page → panel: the requested snapshot, ingested into the trace store.
  | { kind: "snapshot"; frame: EventsBatchMessage["payload"] };

export const PANEL_PORT_PREFIX = "react-lens/panel:";
export const PAGE_PORT_NAME = "react-lens/page";
