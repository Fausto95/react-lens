import { describe, it, expect } from "vite-plus/test";
import { createMessageBuffer } from "./buffer.js";
import type { PortMessage } from "../transport.js";

function hello(n: number): PortMessage {
  return { kind: "hello", reactVersion: `v${n}` };
}

describe("createMessageBuffer", () => {
  it("replays messages in order", () => {
    const buf = createMessageBuffer(10);
    buf.push(hello(1));
    buf.push(hello(2));
    expect(
      buf.snapshot().map((m) => (m.kind === "hello" ? m.reactVersion : null)),
    ).toEqual(["v1", "v2"]);
  });

  it("drops the oldest messages when full so capture can keep running", () => {
    // While the panel is disconnected, frames only land in this buffer. A hard
    // cap without eviction would either OOM or start rejecting new events —
    // both worse than losing the oldest window.
    const buf = createMessageBuffer(3);
    buf.push(hello(1));
    buf.push(hello(2));
    buf.push(hello(3));
    buf.push(hello(4));
    expect(buf.length).toBe(3);
    expect(
      buf.snapshot().map((m) => (m.kind === "hello" ? m.reactVersion : null)),
    ).toEqual(["v2", "v3", "v4"]);
  });
});
