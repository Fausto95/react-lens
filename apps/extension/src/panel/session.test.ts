import { describe, it, expect } from "vite-plus/test";
import {
  INITIAL_SESSION,
  stepSession,
  resyncRequest,
  commitFrame,
  failFrame,
} from "./session.js";
import type { PortMessage } from "../transport.js";
import type { EventsBatchMessage } from "@reactlens/protocol";

const EMPTY: EventsBatchMessage["payload"] = { events: [], snapshots: [], instances: [] };

function frame(sessionId: string, seq: number): PortMessage {
  return { kind: "frame", frame: EMPTY, sessionId, seq };
}

function hello(sessionId: string, seq = 1): PortMessage {
  return { kind: "hello", reactVersion: "19.0.0", sessionId, seq };
}

describe("panel session reducer", () => {
  it("adopts the first document and ingests its frames", () => {
    const a = stepSession(INITIAL_SESSION, hello("doc-1"));
    expect(a.state).toEqual({ sessionId: "doc-1", lastSeq: 1, gapAt: null });
    expect(a.actions).toEqual([{ type: "reset-store" }]);

    const b = stepSession(a.state, frame("doc-1", 2));
    expect(b.state.lastSeq).toBe(2);
    expect(b.actions).toEqual([{ type: "ingest", frame: EMPTY, seq: 2 }]);
  });

  it("resets the store when the page announces a new document", () => {
    // Page-side id factories restart at 1 on every load; without a reset the
    // new document's renders collide with the old ones and are dropped.
    const first = stepSession(INITIAL_SESSION, hello("doc-1")).state;
    const seen = stepSession(first, frame("doc-1", 7)).state;

    const reloaded = stepSession(seen, hello("doc-2"));
    expect(reloaded.actions).toEqual([{ type: "reset-store" }]);
    // The new document's buffer starts its own cursor at 1.
    expect(reloaded.state).toEqual({ sessionId: "doc-2", lastSeq: 1, gapAt: null });
  });

  it("resets on a frame from an unannounced document, then ingests it", () => {
    // `hello` can be lost with the port it was queued on; the frame's own
    // session id is the authority.
    const seen = stepSession(
      stepSession(INITIAL_SESSION, hello("doc-1")).state,
      frame("doc-1", 3),
    ).state;

    const next = stepSession(seen, frame("doc-2", 1));
    expect(next.actions).toEqual([
      { type: "reset-store" },
      { type: "ingest", frame: EMPTY, seq: 1 },
    ]);
    expect(next.state).toEqual({ sessionId: "doc-2", lastSeq: 1, gapAt: null });
  });

  it("ignores a replayed frame the panel already ingested", () => {
    const seen = stepSession(
      stepSession(INITIAL_SESSION, hello("doc-1")).state,
      frame("doc-1", 5),
    ).state;
    const stale = stepSession(seen, frame("doc-1", 3));
    expect(stale.actions).toEqual([]);
    expect(stale.state.lastSeq).toBe(5);
  });

  it("asks for a resync when the page port (re)connects", () => {
    const seen = stepSession(
      stepSession(INITIAL_SESSION, hello("doc-1")).state,
      frame("doc-1", 4),
    ).state;
    const reconnect = stepSession(seen, { kind: "page-connected" });
    expect(reconnect.actions).toEqual([{ type: "resync" }]);
    expect(reconnect.state).toEqual(seen);
  });

  it("carries the cursor in the resync request", () => {
    expect(resyncRequest({ sessionId: "doc-1", lastSeq: 12, gapAt: null })).toEqual({
      kind: "panel-ready",
      sessionId: "doc-1",
      fromSeq: 12,
    });
    expect(resyncRequest(INITIAL_SESSION)).toEqual({
      kind: "panel-ready",
      sessionId: null,
      fromSeq: 0,
    });
  });

  it("passes non-session messages through untouched", () => {
    const snapshot: PortMessage = { kind: "snapshot", frame: EMPTY };
    const out = stepSession(INITIAL_SESSION, snapshot);
    expect(out.state).toEqual(INITIAL_SESSION);
    expect(out.actions).toEqual([]);
  });
});

describe("frame quarantine", () => {
  /** A panel that has adopted doc-1 and ingested seq 1..3. */
  function settled() {
    let state = stepSession(INITIAL_SESSION, hello("doc-1")).state;
    for (const seq of [2, 3]) {
      state = stepSession(state, frame("doc-1", seq)).state;
      state = commitFrame(state, seq);
    }
    return state;
  }

  it("holds the resync cursor at a frame whose ingest threw", () => {
    // The cursor is the only record of what the panel has. Advancing it past a
    // frame the store rejected loses that frame for good.
    const state = failFrame(stepSession(settled(), frame("doc-1", 4)).state, 4);

    expect(state.lastSeq).toBe(4);
    expect(resyncRequest(state).fromSeq).toBe(3);
  });

  it("keeps ingesting later frames while a gap is open", () => {
    let state = failFrame(stepSession(settled(), frame("doc-1", 4)).state, 4);
    const next = stepSession(state, frame("doc-1", 5));
    expect(next.actions).toEqual([{ type: "ingest", frame: EMPTY, seq: 5 }]);

    // ...but the cursor still stops short of the gap, so a resync re-delivers it.
    state = commitFrame(next.state, 5);
    expect(resyncRequest(state).fromSeq).toBe(3);
  });

  it("re-ingests the quarantined frame when it is replayed", () => {
    // Without this the replayed frame looks stale (seq <= lastSeq) and the gap
    // could never close.
    const state = failFrame(stepSession(settled(), frame("doc-1", 4)).state, 4);
    const replayed = stepSession(state, frame("doc-1", 4));

    expect(replayed.actions).toEqual([{ type: "ingest", frame: EMPTY, seq: 4 }]);
  });

  it("closes the gap once the frame ingests, and the cursor catches up", () => {
    let state = failFrame(stepSession(settled(), frame("doc-1", 4)).state, 4);
    state = commitFrame(stepSession(state, frame("doc-1", 5)).state, 5);
    state = commitFrame(stepSession(state, frame("doc-1", 4)).state, 4);

    expect(state.gapAt).toBeNull();
    expect(resyncRequest(state).fromSeq).toBe(5);
  });

  it("holds at the earliest gap when several frames fail", () => {
    let state = failFrame(stepSession(settled(), frame("doc-1", 6)).state, 6);
    state = failFrame(stepSession(state, frame("doc-1", 4)).state, 4);

    expect(resyncRequest(state).fromSeq).toBe(3);
  });

  it("forgets a gap from the previous document", () => {
    const state = failFrame(stepSession(settled(), frame("doc-1", 4)).state, 4);
    const reloaded = stepSession(state, hello("doc-2"));

    expect(reloaded.state).toEqual({ sessionId: "doc-2", lastSeq: 1, gapAt: null });
  });
});
