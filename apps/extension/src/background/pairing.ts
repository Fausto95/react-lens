/**
 * Panel ↔ page pairing policy for the background relay.
 *
 * Capture lives in the page and is buffered by the content script. The panel
 * is a subscriber, not the owner of recording — opening/closing DevTools must
 * not turn capture off, or events during the disconnect gap (and forever after,
 * if reconnect never sends `record: true`) are lost.
 */

import type { PortMessage } from "../transport.js";

/** Outbound messages the background should send to the page port. */
export type PageCommand = Extract<PortMessage, { kind: "panel-ready" } | { kind: "record" }>;

/** Panel just connected — ask the content script to replay its durable buffer. */
export function commandsOnPanelConnect(): readonly PageCommand[] {
  return [{ kind: "panel-ready" }];
}

/**
 * Panel disconnected. Keep page capture running into the content buffer so
 * activity while DevTools is closed (or the port is recycling) is still there
 * when a panel pairs again.
 */
export function commandsOnPanelDisconnect(): readonly PageCommand[] {
  return [];
}
