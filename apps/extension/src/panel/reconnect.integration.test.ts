import { describe, it, expect } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  ComponentId,
  ComponentInstance,
  EventId,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  CommitId,
} from "@reactlens/protocol";
import { createMessageBuffer } from "../content/buffer.js";
import { INITIAL_SESSION, stepSession, resyncRequest, type SessionState } from "./session.js";
import type { PortMessage, SequencedMessage, Unsequenced } from "../transport.js";

/**
 * The whole page→panel path, minus Chrome: the content script's durable buffer,
 * the panel's session reducer and the real trace store. These are the two
 * failures users hit — a disconnect gap, and a page reload — driven end to end.
 */

function instance(id: number, name: string): ComponentInstance {
  return {
    id: id as ComponentId,
    type: id as never,
    name,
    rootId: 1 as never,
    compiler: { compiled: true, memoized: true },
  };
}

function render(n: number): RenderEvent {
  return {
    id: n as EventId,
    type: "render",
    timestamp: n,
    renderId: n as RenderId,
    commitId: n as CommitId,
    componentId: 1 as ComponentId,
    selfDuration: 1,
    totalDuration: 1,
    reasons: [{ type: "mount" }],
    compiler: { compiled: true, memoized: true },
  };
}

/** One page, one content-script buffer, one panel store. */
function harness() {
  const store = new TraceStore();
  let panel: SessionState = INITIAL_SESSION;
  let connected = true;
  let buffer = createMessageBuffer(50);

  /** Panel side of the wire. */
  const deliver = (msg: PortMessage) => {
    const { state, actions } = stepSession(panel, msg);
    panel = state;
    for (const action of actions) {
      if (action.type === "reset-store") store.clear();
      if (action.type === "ingest") store.ingest(action.frame);
      if (action.type === "resync") replay(resyncRequest(panel));
    }
  };

  /** Content-script side of `panel-ready`. */
  const replay = (req: Extract<PortMessage, { kind: "panel-ready" }>) => {
    const from = req.sessionId === buffer.sessionId ? req.fromSeq : 0;
    for (const msg of buffer.since(from)) deliver(msg);
  };

  return {
    store,
    get panel() {
      return panel;
    },
    /** The page emits a message; it reaches the panel only while connected. */
    emit(msg: Unsequenced<SequencedMessage>) {
      const stamped = buffer.push(msg);
      if (connected) deliver(stamped);
    },
    disconnect() {
      connected = false;
    },
    /** Background reports a live page port again; the panel drives the resync. */
    reconnect() {
      connected = true;
      deliver({ kind: "page-connected" });
    },
    /** A document load: fresh content script, fresh buffer, fresh page ids. */
    reload() {
      buffer = createMessageBuffer(50);
      connected = true;
    },
  };
}

function frameOf(
  sessionId: string,
  payload: Partial<EventsBatchMessage["payload"]>,
): Unsequenced<SequencedMessage> {
  return {
    kind: "frame",
    sessionId,
    frame: { events: [], snapshots: [], instances: [], ...payload },
  };
}

describe("page → panel resync", () => {
  it("delivers exactly the frames missed while the panel was disconnected", () => {
    const h = harness();
    h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1" });
    h.emit(frameOf("doc-1", { instances: [instance(1, "App")], events: [render(1)] }));

    h.disconnect();
    for (let n = 2; n <= 20; n++) h.emit(frameOf("doc-1", { events: [render(n)] }));
    h.reconnect();

    const renders = h.store.rendersOf(1 as ComponentId);
    expect(renders.map((r) => r.renderId)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // No duplicates: the log holds one event per render, in order.
    expect(h.store.allEvents()).toHaveLength(20);
    expect(h.store.commits()).toHaveLength(20);
    expect(h.panel.lastSeq).toBe(21); // hello + 20 frames
  });

  it("does not re-ingest events the panel already had", () => {
    const h = harness();
    h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1" });
    h.emit(frameOf("doc-1", { events: [render(1)] }));
    h.reconnect();
    h.reconnect();

    expect(h.store.allEvents()).toHaveLength(1);
  });

  it("keeps the tree placeable when the buffer evicted the mount frame", () => {
    const h = harness();
    h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1" });
    h.disconnect();
    h.emit(frameOf("doc-1", { instances: [instance(1, "App")] }));
    // Overflow the 50-entry buffer so the mount frame is evicted.
    for (let n = 2; n <= 80; n++) h.emit(frameOf("doc-1", { events: [render(n)] }));
    h.reconnect();

    expect(h.store.instance(1 as ComponentId)?.name).toBe("App");
    expect(h.store.rendersOf(1 as ComponentId).length).toBeGreaterThan(0);
  });

  it("captures the reloaded page even though its ids restart at 1", () => {
    // The reported symptom: after a reload the panel showed nothing, because
    // renderIds 1..N were still in the store from the previous document.
    const h = harness();
    h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1" });
    for (let n = 1; n <= 5; n++) {
      h.emit(frameOf("doc-1", { instances: [instance(1, "Old")], events: [render(n)] }));
    }
    expect(h.store.allEvents()).toHaveLength(5);

    h.reload();
    h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-2" });
    for (let n = 1; n <= 5; n++) {
      h.emit(frameOf("doc-2", { instances: [instance(1, "New")], events: [render(n)] }));
    }

    expect(h.store.allEvents()).toHaveLength(5);
    expect(h.store.rendersOf(1 as ComponentId).map((r) => r.renderId)).toEqual([1, 2, 3, 4, 5]);
    expect(h.store.instance(1 as ComponentId)?.name).toBe("New");
    expect(h.store.commits()).toHaveLength(5);
  });
});
