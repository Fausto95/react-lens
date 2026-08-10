import type { EventsBatchMessage } from "@react-lens/protocol";

/** Envelope for page(MAIN) ↔ content(ISOLATED) hops over window.postMessage. */
export const PAGE_SOURCE = "react-lens/page";
export const CONTENT_SOURCE = "react-lens/content";

export type PageToContent =
  | { source: typeof PAGE_SOURCE; kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { source: typeof PAGE_SOURCE; kind: "hello"; reactVersion: string | null };

export type ContentToPage = {
  source: typeof CONTENT_SOURCE;
  kind: "record";
  recording: boolean;
};

/** Port protocol for content ↔ background ↔ panel hops. */
export type PortMessage =
  | { kind: "frame"; frame: EventsBatchMessage["payload"] }
  | { kind: "hello"; reactVersion: string | null }
  | { kind: "record"; recording: boolean };

export const PANEL_PORT_PREFIX = "react-lens/panel:";
export const PAGE_PORT_NAME = "react-lens/page";
