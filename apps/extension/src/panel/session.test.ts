import { describe, it, expect } from "vite-plus/test";
import { INITIAL_SESSION, stepSession, resyncRequest } from "./session.js";
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
    expect(a.state).toEqual({ sessionId: "doc-1", lastSeq: 1 });
    expect(a.actions).toEqual([{ type: "reset-store" }]);

    const b = stepSession(a.state, frame("doc-1", 2));
    expect(b.state.lastSeq).toBe(2);
    expect(b.actions).toEqual([{ type: "ingest", frame: EMPTY }]);
  });

  it("resets the store when the page announces a new document", () => {
    // Page-side id factories restart at 1 on every load; without a reset the
    // new document's renders collide with the old ones and are dropped.
    const first = stepSession(INITIAL_SESSION, hello("doc-1")).state;
    const seen = stepSession(first, frame("doc-1", 7)).state;

    const reloaded = stepSession(seen, hello("doc-2"));
    expect(reloaded.actions).toEqual([{ type: "reset-store" }]);
    // The new document's buffer starts its own cursor at 1.
    expect(reloaded.state).toEqual({ sessionId: "doc-2", lastSeq: 1 });
  });

  it("resets on a frame from an unannounced document, then ingests it", () => {
    // `hello` can be lost with the port it was queued on; the frame's own
    // session id is the authority.
    const seen = stepSession(
      stepSession(INITIAL_SESSION, hello("doc-1")).state,
      frame("doc-1", 3),
    ).state;

    const next = stepSession(seen, frame("doc-2", 1));
    expect(next.actions).toEqual([{ type: "reset-store" }, { type: "ingest", frame: EMPTY }]);
    expect(next.state).toEqual({ sessionId: "doc-2", lastSeq: 1 });
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
    expect(resyncRequest({ sessionId: "doc-1", lastSeq: 12 })).toEqual({
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
