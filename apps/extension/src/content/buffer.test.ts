import { describe, it, expect } from "vite-plus/test";
import { createMessageBuffer, SPILL_CHUNK } from "./buffer.js";
import { parseSpillKey, type SpillStore } from "./spill.js";
import type { PortMessage, Unsequenced, SequencedMessage } from "../transport.js";
import type {
  ComponentId,
  ComponentInstance,
  EventId,
  EventsBatchMessage,
  RenderEvent,
  RenderId,
  CommitId,
} from "@reactlens/protocol";

const SESSION = "session-a";

function hello(version: string, sessionId = SESSION): Unsequenced<SequencedMessage> {
  return { kind: "hello", reactVersion: version, sessionId, protocolVersion: 1 };
}

function instance(id: number): ComponentInstance {
  return {
    id: id as ComponentId,
    type: id as never,
    name: `C${id}`,
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

function frame(instances: ComponentInstance[], sessionId = SESSION): Unsequenced<SequencedMessage> {
  const payload: EventsBatchMessage["payload"] = { events: [], snapshots: [], instances };
  return { kind: "frame", frame: payload, sessionId };
}

/** A frame carrying one render event, so loss is countable. */
function renderFrame(n: number, sessionId = SESSION): Unsequenced<SequencedMessage> {
  const payload: EventsBatchMessage["payload"] = {
    events: [render(n)],
    snapshots: [],
    instances: [instance(n)],
  };
  return { kind: "frame", frame: payload, sessionId };
}

const versions = (msgs: readonly PortMessage[]) =>
  msgs.map((m) => (m.kind === "hello" ? m.reactVersion : null));

/** Every instance the replayed messages carry, in arrival order. */
const instancesIn = (msgs: readonly PortMessage[]) =>
  msgs.flatMap((m) => (m.kind === "frame" ? m.frame.instances.map((i) => i.id) : []));

/** Every render event id in the replay — what "no lost traces" means. */
const renderIdsIn = (msgs: readonly PortMessage[]) =>
  msgs.flatMap((m) =>
    m.kind === "frame"
      ? m.frame.events.filter((e) => e.type === "render").map((e) => e.timestamp)
      : [],
  );

/** In-memory SpillStore, optionally rejecting writes to simulate a full quota. */
function fakeSpill(opts: { full?: boolean } = {}) {
  const data = new Map<string, PortMessage[]>();
  let writes = 0;
  const store: SpillStore = {
    async write(key, msgs) {
      writes++;
      if (opts.full) throw new Error("QUOTA_BYTES quota exceeded");
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
  return { store, data, writes: () => writes };
}

describe("createMessageBuffer", () => {
  it("stamps a monotonic seq that survives eviction", () => {
    const buf = createMessageBuffer(2);
    expect(buf.push(hello("v1")).seq).toBe(1);
    expect(buf.push(hello("v2")).seq).toBe(2);
    expect(buf.push(hello("v3")).seq).toBe(3);
    expect(buf.lastSeq).toBe(3);
  });

  it("replays only what the panel has not seen", async () => {
    // Replaying the whole buffer on every reconnect duplicated interactions
    // and appended stale events after newer ones, breaking commit order.
    const buf = createMessageBuffer(10);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    const seen = buf.push(hello("v3")).seq;
    buf.push(hello("v4"));

    expect(versions(await buf.since(seen))).toEqual(["v4"]);
    expect(await buf.since(buf.lastSeq)).toEqual([]);
  });

  it("replays everything from seq 0", async () => {
    const buf = createMessageBuffer(10);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    expect(versions(await buf.since(0))).toEqual(["v1", "v2"]);
  });

  it("drops the oldest messages when full and has no spill store", async () => {
    // Last resort only: with nowhere to put the overflow, losing the oldest
    // window still beats OOM or refusing new events.
    const buf = createMessageBuffer(3);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    buf.push(hello("v3"));
    buf.push(hello("v4"));
    expect(buf.length).toBe(3);
    expect(versions(await buf.since(0))).toEqual(["v2", "v3", "v4"]);
  });

  it("still carries every known instance after the ring wraps", async () => {
    // The oldest frames are the mount frames, and they are the only ones
    // carrying most instances. Evicting them left the panel ingesting renders
    // for components it could not place in the tree.
    const buf = createMessageBuffer(2);
    buf.push(frame([instance(1), instance(2)]));
    buf.push(frame([instance(3)]));
    buf.push(frame([instance(4)]));

    expect(new Set(instancesIn(await buf.since(0)))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("does not prepend a dictionary when nothing was evicted", async () => {
    const buf = createMessageBuffer(10);
    buf.push(frame([instance(1)]));
    expect(await buf.since(0)).toHaveLength(1);
  });

  it("tracks the page session id announced by hello", () => {
    const buf = createMessageBuffer(10);
    expect(buf.sessionId).toBeNull();
    buf.push(hello("v1", "doc-1"));
    expect(buf.sessionId).toBe("doc-1");
  });

  it("starts a fresh buffer for a new document", async () => {
    // A reload gives the page new id factories; nothing from the previous
    // document may be replayed into the new session.
    const buf = createMessageBuffer(10);
    buf.push(hello("v1", "doc-1"));
    buf.push(frame([instance(1)], "doc-1"));
    buf.push(hello("v1", "doc-2"));

    expect(buf.sessionId).toBe("doc-2");
    expect(buf.length).toBe(1);
    expect(versions(await buf.since(0))).toEqual(["v1"]);
    expect(instancesIn(await buf.since(0))).toEqual([]);
  });
});

describe("message buffer overflow", () => {
  it("spills the overflow instead of losing it", async () => {
    // This is the DevTools-was-closed case: capture runs for minutes, the ring
    // wraps many times over, and every one of those renders still belongs to
    // the session the user is about to open.
    const spill = fakeSpill();
    const buf = createMessageBuffer(4, spill.store);
    const total = 4 + SPILL_CHUNK * 2;
    for (let n = 1; n <= total; n++) buf.push(renderFrame(n));

    const replayed = await buf.since(0);
    expect(renderIdsIn(replayed)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(buf.compacted).toBeNull();
  });

  it("replays spilled and in-memory messages in seq order, once each", async () => {
    const spill = fakeSpill();
    const buf = createMessageBuffer(4, spill.store);
    for (let n = 1; n <= 4 + SPILL_CHUNK; n++) buf.push(renderFrame(n));

    const seqs = (await buf.since(0)).map((m) =>
      m.kind === "frame" || m.kind === "hello" ? m.seq : 0,
    );
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("replays only the tail the panel is missing, across the spill boundary", async () => {
    const spill = fakeSpill();
    const buf = createMessageBuffer(4, spill.store);
    const total = 4 + SPILL_CHUNK;
    for (let n = 1; n <= total; n++) buf.push(renderFrame(n));

    // Ask from halfway into the spilled region.
    const from = Math.floor(SPILL_CHUNK / 2);
    expect(renderIdsIn(await buf.since(from))).toEqual(
      Array.from({ length: total - from }, (_, i) => from + i + 1),
    );
  });

  it("forgets messages the panel has acknowledged", async () => {
    // Retaining acked frames is what makes the ring overflow in the first
    // place: once the panel has them durably, this copy is dead weight.
    const spill = fakeSpill();
    const buf = createMessageBuffer(4, spill.store);
    for (let n = 1; n <= 4 + SPILL_CHUNK; n++) buf.push(renderFrame(n));

    await buf.ack(SPILL_CHUNK);
    expect(renderIdsIn(await buf.since(SPILL_CHUNK))).toEqual(
      Array.from({ length: 4 }, (_, i) => SPILL_CHUNK + i + 1),
    );
    for (const key of spill.data.keys()) {
      expect(parseSpillKey(key)!.hiSeq).toBeGreaterThan(SPILL_CHUNK);
    }
  });

  it("reports the range it had to compact when the spill store is full", async () => {
    // Storage quota is finite, so there is a floor. What matters is that the
    // panel is told, instead of showing a gap-free timeline that has a hole.
    const spill = fakeSpill({ full: true });
    const buf = createMessageBuffer(4, spill.store);
    const total = 4 + SPILL_CHUNK;
    for (let n = 1; n <= total; n++) buf.push(renderFrame(n));

    const replayed = await buf.since(0);
    expect(buf.compacted).toEqual({ fromSeq: 1, toSeq: SPILL_CHUNK, frames: SPILL_CHUNK });
    // The instance dictionary still comes through, so the tail stays placeable.
    expect(new Set(instancesIn(replayed)).size).toBe(total);
  });

  it("drops the previous document's spilled chunks", async () => {
    const spill = fakeSpill();
    const buf = createMessageBuffer(4, spill.store);
    for (let n = 1; n <= 4 + SPILL_CHUNK; n++) buf.push(renderFrame(n, "doc-1"));
    expect(spill.data.size).toBeGreaterThan(0);

    buf.push(hello("v1", "doc-2"));
    await buf.settled();

    expect([...spill.data.keys()].filter((k) => parseSpillKey(k)!.sessionId === "doc-1")).toEqual(
      [],
    );
  });

  it("caps the instance dictionary so a huge app cannot grow it forever", async () => {
    // 100k mounted components is a real number, and this map was never evicted.
    const buf = createMessageBuffer(2, undefined, { maxInstances: 3 });
    for (let n = 1; n <= 10; n++) buf.push(renderFrame(n));

    expect(buf.instanceCount).toBe(3);
  });
});
