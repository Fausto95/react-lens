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
import { createMessageBuffer, SPILL_CHUNK } from "../content/buffer.js";
import type { SpillStore } from "../content/spill.js";
import {
  INITIAL_SESSION,
  stepSession,
  resyncRequest,
  commitFrame,
  failFrame,
  type SessionState,
} from "./session.js";
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

/** In-memory stand-in for `chrome.storage.local`. */
function memorySpill(): SpillStore {
  const data = new Map<string, PortMessage[]>();
  return {
    async write(key, msgs) {
      data.set(key, [...msgs]);
    },
    async read(key) {
      return data.get(key);
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async list() {
      return [...data.keys()];
    },
  };
}

/**
 * One page, one content-script buffer, one panel store.
 *
 * `rejectIngest` stands in for a store that throws on a frame — the panel must
 * keep its cursor behind that frame so the resync brings it back.
 */
function harness(opts: { capacity?: number; spill?: boolean } = {}) {
  const capacity = opts.capacity ?? 50;
  const store = new TraceStore();
  let panel: SessionState = INITIAL_SESSION;
  let connected = true;
  const makeBuffer = () =>
    createMessageBuffer(capacity, opts.spill === false ? undefined : memorySpill());
  let buffer = makeBuffer();
  /** Seqs the store should refuse, once each. */
  const rejectIngest = new Set<number>();
  let acks = 0;

  /** Panel side of the wire. */
  const deliver = async (msg: PortMessage) => {
    const before = resyncRequest(panel).fromSeq;
    const { state, actions } = stepSession(panel, msg);
    panel = state;
    for (const action of actions) {
      if (action.type === "reset-store") store.clear();
      if (action.type === "ingest") {
        if (rejectIngest.has(action.seq)) {
          rejectIngest.delete(action.seq);
          panel = failFrame(panel, action.seq);
        } else {
          store.ingest(action.frame);
          panel = commitFrame(panel, action.seq);
        }
      }
      if (action.type === "resync") await replay(resyncRequest(panel));
    }
    // The panel acks its contiguous durable prefix; the page then forgets it.
    const after = resyncRequest(panel);
    if (after.sessionId !== null && after.fromSeq > before) {
      acks++;
      await buffer.ack(after.fromSeq);
    }
  };

  /** Content-script side of `panel-ready`. */
  const replay = async (req: Extract<PortMessage, { kind: "panel-ready" }>) => {
    const from = req.sessionId === buffer.sessionId ? req.fromSeq : 0;
    for (const msg of await buffer.since(from)) await deliver(msg);
  };

  return {
    store,
    get panel() {
      return panel;
    },
    get compacted() {
      return buffer.compacted;
    },
    get ackCount() {
      return acks;
    },
    /** Make the store refuse this frame's ingest, once. */
    failIngestAt(seq: number) {
      rejectIngest.add(seq);
    },
    /** The page emits a message; it reaches the panel only while connected. */
    async emit(msg: Unsequenced<SequencedMessage>) {
      const stamped = buffer.push(msg);
      if (connected) await deliver(stamped);
    },
    disconnect() {
      connected = false;
    },
    /** Background reports a live page port again; the panel drives the resync. */
    async reconnect() {
      connected = true;
      await deliver({ kind: "page-connected" });
    },
    /** A document load: fresh content script, fresh buffer, fresh page ids. */
    reload() {
      buffer = makeBuffer();
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
  it("delivers exactly the frames missed while the panel was disconnected", async () => {
    const h = harness();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    await h.emit(frameOf("doc-1", { instances: [instance(1, "App")], events: [render(1)] }));

    h.disconnect();
    for (let n = 2; n <= 20; n++) await h.emit(frameOf("doc-1", { events: [render(n)] }));
    await h.reconnect();

    const renders = h.store.rendersOf(1 as ComponentId);
    expect(renders.map((r) => r.renderId)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    // No duplicates: the log holds one event per render, in order.
    expect(h.store.allEvents()).toHaveLength(20);
    expect(h.store.commits()).toHaveLength(20);
    expect(h.panel.lastSeq).toBe(21); // hello + 20 frames
  });

  it("does not re-ingest events the panel already had", async () => {
    const h = harness();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    await h.emit(frameOf("doc-1", { events: [render(1)] }));
    await h.reconnect();
    await h.reconnect();

    expect(h.store.allEvents()).toHaveLength(1);
  });

  it("keeps the tree placeable when the buffer evicted the mount frame", async () => {
    const h = harness();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    h.disconnect();
    await h.emit(frameOf("doc-1", { instances: [instance(1, "App")] }));
    // Overflow the 50-entry buffer so the mount frame is evicted.
    for (let n = 2; n <= 80; n++) await h.emit(frameOf("doc-1", { events: [render(n)] }));
    await h.reconnect();

    expect(h.store.instance(1 as ComponentId)?.name).toBe("App");
    expect(h.store.rendersOf(1 as ComponentId).length).toBeGreaterThan(0);
  });

  it("captures the reloaded page even though its ids restart at 1", async () => {
    // The reported symptom: after a reload the panel showed nothing, because
    // renderIds 1..N were still in the store from the previous document.
    const h = harness();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    for (let n = 1; n <= 5; n++) {
      await h.emit(frameOf("doc-1", { instances: [instance(1, "Old")], events: [render(n)] }));
    }
    expect(h.store.allEvents()).toHaveLength(5);

    h.reload();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-2", protocolVersion: 1 });
    for (let n = 1; n <= 5; n++) {
      await h.emit(frameOf("doc-2", { instances: [instance(1, "New")], events: [render(n)] }));
    }

    expect(h.store.allEvents()).toHaveLength(5);
    expect(h.store.rendersOf(1 as ComponentId).map((r) => r.renderId)).toEqual([1, 2, 3, 4, 5]);
    expect(h.store.instance(1 as ComponentId)?.name).toBe("New");
    expect(h.store.commits()).toHaveLength(5);
  });
});

describe("no trace is lost", () => {
  it("delivers every render after the buffer overflowed many times over", async () => {
    // The DevTools-closed case at real-app scale: capacity is seconds, the
    // session is minutes. Every one of these renders must survive to the replay.
    const h = harness({ capacity: 20 });
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    await h.emit(frameOf("doc-1", { instances: [instance(1, "App")] }));

    h.disconnect();
    const total = 20 + SPILL_CHUNK * 3;
    for (let n = 1; n <= total; n++) await h.emit(frameOf("doc-1", { events: [render(n)] }));
    await h.reconnect();

    expect(h.compacted).toBeNull();
    expect(h.store.renderCount(1 as ComponentId)).toBe(total);
    expect(h.store.instance(1 as ComponentId)?.name).toBe("App");
  });

  it("re-delivers a frame the store refused, and only that frame", async () => {
    const h = harness();
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    await h.emit(frameOf("doc-1", { instances: [instance(1, "App")], events: [render(1)] }));

    h.failIngestAt(3);
    await h.emit(frameOf("doc-1", { events: [render(2)] })); // seq 3 — refused
    await h.emit(frameOf("doc-1", { events: [render(3)] })); // seq 4 — kept
    expect(h.store.renderCount(1 as ComponentId)).toBe(2);

    await h.reconnect();
    expect(h.store.renderCount(1 as ComponentId)).toBe(3);
    expect(h.store.allEvents()).toHaveLength(3);
    expect(h.panel.gapAt).toBeNull();
  });

  it("keeps the buffer small once the panel acknowledges what it kept", async () => {
    // Without acks the page retains the entire session behind a live panel and
    // spills for no reason at all.
    const h = harness({ capacity: 20 });
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    for (let n = 1; n <= 200; n++) await h.emit(frameOf("doc-1", { events: [render(n)] }));

    expect(h.ackCount).toBeGreaterThan(0);
    // Nothing is left to replay: the panel has it all and said so.
    expect(await h.reconnect().then(() => h.store.renderCount(1 as ComponentId))).toBe(200);
  });

  it("holds the page's copy of a frame the panel could not keep", async () => {
    // The ack is the page's only signal that a frame is safe to forget, so a
    // refused frame must not be acked away.
    const h = harness({ capacity: 20 });
    await h.emit({ kind: "hello", reactVersion: "19.0.0", sessionId: "doc-1", protocolVersion: 1 });
    h.failIngestAt(2);
    for (let n = 1; n <= 100; n++) await h.emit(frameOf("doc-1", { events: [render(n)] }));

    await h.reconnect();
    expect(h.store.renderCount(1 as ComponentId)).toBe(100);
  });
});
