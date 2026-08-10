import type { EventsBatchMessage, RenderId, ComponentId } from "@react-lens/protocol";

/** Envelope for page(MAIN) ↔ content(ISOLATED) hops over window.postMessage. */
export const PAGE_SOURCE = "react-lens/page";
export const CONTENT_SOURCE = "react-lens/content";

export type PageToContent =
  | { source: typeof PAGE_SOURCE; kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { source: typeof PAGE_SOURCE; kind: "hello"; reactVersion: string | null }
  // Response to a snapshot-request: not buffered, relayed straight through.
  | { source: typeof PAGE_SOURCE; kind: "snapshot"; frame: EventsBatchMessage["payload"] }
  // Response to a source-request: module / map text from the page origin.
  | {
      source: typeof PAGE_SOURCE;
      kind: "source";
      requestId: string;
      url: string;
      body?: string;
      error?: string;
    };

export type ContentToPage =
  | { source: typeof CONTENT_SOURCE; kind: "record"; recording: boolean }
  // Panel asked for the heavy snapshot of a specific render (built lazily,
  // since snapshots aren't streamed inline for large apps).
  | { source: typeof CONTENT_SOURCE; kind: "snapshot-request"; renderId: RenderId }
  // Panel asks the page to fetch a URL (JS / source map) same-origin.
  | { source: typeof CONTENT_SOURCE; kind: "source-request"; requestId: string; url: string }
  // Panel hovered/selected a component: paint (id) or clear (null) its overlay.
  | { source: typeof CONTENT_SOURCE; kind: "highlight"; componentId: ComponentId | null }
  // Panel replayed a commit: flash these components on the page as a wave.
  | { source: typeof CONTENT_SOURCE; kind: "replay"; componentIds: ComponentId[] };

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
  | { kind: "snapshot"; frame: EventsBatchMessage["payload"] }
  // panel → page: fetch module / source-map text via the page origin.
  | { kind: "source-request"; requestId: string; url: string }
  // page → panel: fetched text (or error).
  | { kind: "source"; requestId: string; url: string; body?: string; error?: string }
  // panel → page: paint (id) or clear (null) a component's DOM overlay.
  | { kind: "highlight"; componentId: ComponentId | null }
  // panel → page: flash a replayed commit's components as a wave.
  | { kind: "replay"; componentIds: ComponentId[] };

export const PANEL_PORT_PREFIX = "react-lens/panel:";
export const PAGE_PORT_NAME = "react-lens/page";
