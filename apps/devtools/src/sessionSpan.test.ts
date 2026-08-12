import { describe, expect, it } from "vite-plus/test";
import { TraceStore } from "@reactlens/trace-engine";
import type {
  CommitId,
  ComponentId,
  EventId,
  RenderEvent,
  RenderId,
} from "@reactlens/protocol";
import { sessionSpanMs } from "./sessionSpan.js";

let seq = 0;
function render(over: Partial<RenderEvent> = {}): RenderEvent {
  const n = ++seq;
  return {
    id: n as EventId,
    type: "render",
    timestamp: 1000,
    renderId: n as RenderId,
    commitId: 1 as CommitId,
    componentId: 1 as ComponentId,
    selfDuration: 12,
    totalDuration: 40,
    reasons: [],
    compiler: { compiled: true, memoized: true },
    ...over,
  };
}

describe("sessionSpanMs", () => {
  it("is 0 on an empty store", () => {
    expect(sessionSpanMs(new TraceStore())).toBe(0);
  });

  it("uses render duration so a single mount commit is not 0.0 s", () => {
    // Commits stamp every render with the same timestamp; the old
    // last.endTimestamp - first.timestamp formula stayed at 0 after mount.
    const store = new TraceStore();
    store.ingest({
      events: [render({ timestamp: 500, selfDuration: 8, totalDuration: 25 })],
      snapshots: [],
      instances: [
        {
          id: 1 as ComponentId,
          type: 1 as never,
          name: "App",
          rootId: 1 as never,
          compiler: { compiled: true, memoized: true },
        },
      ],
    });
    expect(sessionSpanMs(store)).toBe(25);
  });

  it("spans from first to last activity across commits", () => {
    const store = new TraceStore();
    store.ingest({
      events: [
        render({
          timestamp: 100,
          commitId: 1 as CommitId,
          renderId: 1 as RenderId,
          totalDuration: 10,
          selfDuration: 10,
        }),
        render({
          timestamp: 500,
          commitId: 2 as CommitId,
          renderId: 2 as RenderId,
          componentId: 1 as ComponentId,
          totalDuration: 20,
          selfDuration: 20,
        }),
      ],
      snapshots: [],
      instances: [
        {
          id: 1 as ComponentId,
          type: 1 as never,
          name: "App",
          rootId: 1 as never,
          compiler: { compiled: true, memoized: true },
        },
      ],
    });
    expect(sessionSpanMs(store)).toBe(420); // 100 → 520
  });
});
