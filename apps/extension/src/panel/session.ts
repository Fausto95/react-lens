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
 * `lastSeq` is how far the panel has read; `gapAt` is how far it can prove it
 * kept. They differ whenever an ingest throws — see `failFrame`.
 */
export interface SessionState {
  sessionId: string | null;
  /** Highest seq processed. Dedupes a replay against the live stream. */
  lastSeq: number;
  /**
   * Lowest seq the panel cannot prove it kept, or null when it can prove all of
   * them. Set when an ingest throws.
   *
   * The resync cursor stops just short of it, so the content-script buffer
   * re-delivers that frame instead of the panel losing it because it had
   * already "read" it.
   */
  gapAt: number | null;
  /**
   * Seqs above an open gap that did ingest, so closing the gap can skip past
   * them. Capped: on overflow we forget them and let the replay re-deliver,
   * which the store dedupes by event id. Redundant work, never loss.
   */
  ahead: readonly number[];
}

/** Committed-ahead seqs retained while a gap is open. */
const AHEAD_MAX = 256;

export type SessionAction =
  | { type: "reset-store" }
  /** Ingest, then report the outcome via `commitFrame` / `failFrame`. */
  | { type: "ingest"; frame: EventsBatchMessage["payload"]; seq: number }
  | { type: "resync" };

export const INITIAL_SESSION: SessionState = {
  sessionId: null,
  lastSeq: 0,
  gapAt: null,
  ahead: [],
};

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
    // The previous document's gap goes with it: its seqs mean nothing here.
    actions.push({ type: "reset-store" });
    next = { sessionId: msg.sessionId, lastSeq: 0, gapAt: null, ahead: [] };
  } else if (msg.seq <= state.lastSeq && !needsReingest(state, msg.seq)) {
    // Already ingested; a replay overlapped the live stream.
    return { state, actions: [] };
  }

  next = { ...next, lastSeq: Math.max(next.lastSeq, msg.seq) };
  if (msg.kind === "frame") actions.push({ type: "ingest", frame: msg.frame, seq: msg.seq });
  return { state: next, actions };
}

/** The frame is in the store: this seq no longer needs re-delivering. */
export function commitFrame(state: SessionState, seq: number): SessionState {
  const { gapAt } = state;
  if (gapAt === null || seq < gapAt) return state;
  if (seq > gapAt) {
    if (state.ahead.length >= AHEAD_MAX) return { ...state, ahead: [] };
    return { ...state, ahead: [...state.ahead, seq] };
  }

  // The gap itself landed. Walk forward over whatever already committed above
  // it; the first seq we cannot account for becomes the new cursor.
  const committed = new Set(state.ahead);
  let at = seq + 1;
  while (committed.has(at)) at++;
  if (at > state.lastSeq) return { ...state, gapAt: null, ahead: [] };
  return { ...state, gapAt: at, ahead: state.ahead.filter((s) => s > at) };
}

/**
 * The frame did not make it into the store. Hold the resync cursor behind it —
 * advancing past a frame the store rejected is how a trace is lost silently.
 */
export function failFrame(state: SessionState, seq: number): SessionState {
  if (state.gapAt !== null && state.gapAt <= seq) return state;
  return { ...state, gapAt: seq, ahead: state.ahead.filter((s) => s > seq) };
}

/** What the panel asks the page for after (re)connecting. */
export function resyncRequest(state: SessionState): Extract<PortMessage, { kind: "panel-ready" }> {
  const fromSeq = state.gapAt === null ? state.lastSeq : state.gapAt - 1;
  return { kind: "panel-ready", sessionId: state.sessionId, fromSeq };
}

/** A replayed seq the panel read but never managed to keep. */
function needsReingest(state: SessionState, seq: number): boolean {
  if (state.gapAt === null || seq < state.gapAt) return false;
  return !state.ahead.includes(seq);
}
