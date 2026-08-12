/**
 * Panel ↔ page pairing policy for the background relay.
 *
 * Capture lives in the page and is buffered by the content script. Two rules
 * keep the stream lossless across the churn MV3 guarantees (worker recycled,
 * DevTools closed, tab backgrounded, page reloaded):
 *
 *  - Recording is always on: opening/closing DevTools must never stop it, and
 *    reconnect re-asserts `record: true` in case an older build (or a stray
 *    control message) left the page paused.
 *  - Replay is the panel's call, not ours. This worker is stateless and has no
 *    idea how much the panel already ingested; when it synthesized
 *    `panel-ready` itself, every restart re-sent the whole buffer — duplicating
 *    non-render events and appending stale ones after newer live frames. So we
 *    only report that a peer appeared and let the panel ask with its cursor.
 */

import type { PortMessage } from "../transport.js";

/** Outbound messages the background should send to the page port. */
export type PageCommand = Extract<PortMessage, { kind: "record" }>;

/** Outbound messages the background should send to the panel port. */
export type PanelCommand = Extract<PortMessage, { kind: "page-connected" }>;

/** Panel just connected — make sure capture is on. */
export function commandsOnPanelConnect(): readonly PageCommand[] {
  return [{ kind: "record", recording: true }];
}

/**
 * A page port (re)appeared — reloaded document, or the worker came back. Only
 * the panel knows which messages it is missing, so nudge it to resync.
 */
export function commandsOnPageConnect(): readonly PanelCommand[] {
  return [{ kind: "page-connected" }];
}

/**
 * Panel disconnected. Keep page capture running into the content buffer so
 * activity while DevTools is closed (or the port is recycling) is still there
 * when a panel pairs again.
 */
export function commandsOnPanelDisconnect(): readonly PageCommand[] {
  return [];
}
