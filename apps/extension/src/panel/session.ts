import type { EventsBatchMessage } from "@reactlens/protocol";
import type { PortMessage } from "../transport.js";

/**
 * Which page session the panel is showing, and how much of it it has.
 *
 * Every id factory — eventId, renderId, commitId, componentId — lives in the
 * inspected page and restarts at 1 on each document load, while the panel's
 * store outlives navigation. Keeping the previous document's log made the new
 * one's renders look like duplicates, and the store dropped them: the panel
 * went dead after a reload. The page's own `sessionId` is the boundary, so the
 * reset arrives in order with the frames instead of racing them (which is what
 * `chrome.devtools.network.onNavigated` did — it could land after the new
 * document's mount frames and wipe them).
 *
 * `lastSeq` is the delivery cursor the content-script buffer replays from.
 */
export interface SessionState {
  sessionId: string | null;
  lastSeq: number;
}

export type SessionAction =
  | { type: "reset-store" }
  | { type: "ingest"; frame: EventsBatchMessage["payload"] }
  | { type: "resync" };

export const INITIAL_SESSION: SessionState = { sessionId: null, lastSeq: 0 };

export interface SessionStep {
  state: SessionState;
  actions: SessionAction[];
}

/**
 * Fold one port message into the session. Pure: the caller performs the
 * actions (clear the store, ingest, post `panel-ready`).
 */
export function stepSession(state: SessionState, msg: PortMessage): SessionStep {
  if (msg.kind === "page-connected") {
    return { state, actions: [{ type: "resync" }] };
  }
  if (msg.kind !== "frame" && msg.kind !== "hello") {
    return { state, actions: [] };
  }

  const actions: SessionAction[] = [];
  let next = state;
  if (msg.sessionId !== state.sessionId) {
    // New document. `hello` normally opens it, but a frame's own session id is
    // just as authoritative — `hello` can be lost with the port it queued on.
    actions.push({ type: "reset-store" });
    next = { sessionId: msg.sessionId, lastSeq: 0 };
  } else if (msg.seq <= state.lastSeq) {
    // Already ingested; a replay overlapped the live stream.
    return { state, actions: [] };
  }

  next = { sessionId: next.sessionId, lastSeq: Math.max(next.lastSeq, msg.seq) };
  if (msg.kind === "frame") actions.push({ type: "ingest", frame: msg.frame });
  return { state: next, actions };
}

/** What the panel asks the page for after (re)connecting. */
export function resyncRequest(state: SessionState): Extract<PortMessage, { kind: "panel-ready" }> {
  return { kind: "panel-ready", sessionId: state.sessionId, fromSeq: state.lastSeq };
}
