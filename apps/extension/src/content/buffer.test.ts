import { describe, it, expect } from "vite-plus/test";
import { createMessageBuffer } from "./buffer.js";
import type { PortMessage, Unsequenced, SequencedMessage } from "../transport.js";
import type { ComponentId, ComponentInstance, EventsBatchMessage } from "@reactlens/protocol";

const SESSION = "session-a";

function hello(version: string, sessionId = SESSION): Unsequenced<SequencedMessage> {
  return { kind: "hello", reactVersion: version, sessionId };
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

function frame(
  instances: ComponentInstance[],
  sessionId = SESSION,
): Unsequenced<SequencedMessage> {
  const payload: EventsBatchMessage["payload"] = { events: [], snapshots: [], instances };
  return { kind: "frame", frame: payload, sessionId };
}

const versions = (msgs: readonly PortMessage[]) =>
  msgs.map((m) => (m.kind === "hello" ? m.reactVersion : null));

/** Every instance the replayed messages carry, in arrival order. */
const instancesIn = (msgs: readonly PortMessage[]) =>
  msgs.flatMap((m) => (m.kind === "frame" ? m.frame.instances.map((i) => i.id) : []));

describe("createMessageBuffer", () => {
  it("stamps a monotonic seq that survives eviction", () => {
    const buf = createMessageBuffer(2);
    expect(buf.push(hello("v1")).seq).toBe(1);
    expect(buf.push(hello("v2")).seq).toBe(2);
    expect(buf.push(hello("v3")).seq).toBe(3);
    expect(buf.lastSeq).toBe(3);
  });

  it("replays only what the panel has not seen", () => {
    // Replaying the whole buffer on every reconnect duplicated interactions
    // and appended stale events after newer ones, breaking commit order.
    const buf = createMessageBuffer(10);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    const seen = buf.push(hello("v3")).seq;
    buf.push(hello("v4"));

    expect(versions(buf.since(seen))).toEqual(["v4"]);
    expect(buf.since(buf.lastSeq)).toEqual([]);
  });

  it("replays everything from seq 0", () => {
    const buf = createMessageBuffer(10);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    expect(versions(buf.since(0))).toEqual(["v1", "v2"]);
  });

  it("drops the oldest messages when full so capture can keep running", () => {
    // While the panel is disconnected, frames only land in this buffer. A hard
    // cap without eviction would either OOM or start rejecting new events —
    // both worse than losing the oldest window.
    const buf = createMessageBuffer(3);
    buf.push(hello("v1"));
    buf.push(hello("v2"));
    buf.push(hello("v3"));
    buf.push(hello("v4"));
    expect(buf.length).toBe(3);
    expect(versions(buf.since(0))).toEqual(["v2", "v3", "v4"]);
  });

  it("still carries every known instance after the ring wraps", () => {
    // The oldest frames are the mount frames, and they are the only ones
    // carrying most instances. Evicting them left the panel ingesting renders
    // for components it could not place in the tree.
    const buf = createMessageBuffer(2);
    buf.push(frame([instance(1), instance(2)]));
    buf.push(frame([instance(3)]));
    buf.push(frame([instance(4)]));

    expect(new Set(instancesIn(buf.since(0)))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("does not prepend a dictionary when nothing was evicted", () => {
    const buf = createMessageBuffer(10);
    buf.push(frame([instance(1)]));
    expect(buf.since(0)).toHaveLength(1);
  });

  it("tracks the page session id announced by hello", () => {
    const buf = createMessageBuffer(10);
    expect(buf.sessionId).toBeNull();
    buf.push(hello("v1", "doc-1"));
    expect(buf.sessionId).toBe("doc-1");
  });

  it("starts a fresh buffer for a new document", () => {
    // A reload gives the page new id factories; nothing from the previous
    // document may be replayed into the new session.
    const buf = createMessageBuffer(10);
    buf.push(hello("v1", "doc-1"));
    buf.push(frame([instance(1)], "doc-1"));
    buf.push(hello("v1", "doc-2"));

    expect(buf.sessionId).toBe("doc-2");
    expect(buf.length).toBe(1);
    expect(versions(buf.since(0))).toEqual(["v1"]);
    expect(instancesIn(buf.since(0))).toEqual([]);
  });
});
