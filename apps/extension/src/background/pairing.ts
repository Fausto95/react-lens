/**
 * Panel ↔ page pairing policy for the background relay.
 *
 * Capture lives in the page and is buffered by the content script. Recording is
 * always on: opening/closing DevTools must never stop it, and reconnect must
 * re-assert `record: true` in case an older build (or a stray control message)
 * left the page paused.
 */

import type { PortMessage } from "../transport.js";

/** Outbound messages the background should send to the page port. */
export type PageCommand = Extract<PortMessage, { kind: "panel-ready" } | { kind: "record" }>;

/** Panel just connected — ensure capture is on, then replay the durable buffer. */
export function commandsOnPanelConnect(): readonly PageCommand[] {
  return [
    { kind: "record", recording: true },
    { kind: "panel-ready" },
  ];
}

/**
 * Panel disconnected. Keep page capture running into the content buffer so
 * activity while DevTools is closed (or the port is recycling) is still there
 * when a panel pairs again.
 */
export function commandsOnPanelDisconnect(): readonly PageCommand[] {
  return [];
}
